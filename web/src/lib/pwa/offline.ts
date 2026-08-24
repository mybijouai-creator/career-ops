"use client";

/**
 * offline.ts — the client half of the offline write queue.
 *
 * The rules live in `public/pwa/queue-core.mjs` and the storage in
 * `queue-db.mjs`; both are shared verbatim with the service worker through the
 * `@pwa/*` alias. This file is only the browser-side ergonomics: try the
 * network first, queue on failure, tell the UI what is pending.
 *
 * The invariant worth restating because it is the whole reason for two stores:
 * a `queue` action replays unattended, an `intent` action never does. Approving
 * a gate offline records the INTENT to approve, and the user is asked again
 * against live state on reconnect — a stale diff must not be able to write.
 */

import { ACTIONS, SYNC_TAG, dispositionOf, idempotencyKey, labelOf } from "@pwa/queue-core.mjs";
import { counts, enqueue, listIntents, listWrites, removeIntent, replayAll } from "@pwa/queue-db.mjs";

/** Every action the queue knows about, read off the shared table so adding one
 *  in queue-core.mjs is immediately callable here and nowhere needs a second
 *  list to be kept in step. */
export type QueueAction = keyof typeof ACTIONS;

/** Action → endpoint, projected from the shared table rather than restated. */
const ACTION_ENDPOINTS: Record<string, string | null> = Object.fromEntries(
  Object.entries(ACTIONS as Record<string, { endpoint: string | null }>).map(([k, v]) => [k, v.endpoint]),
);

function actionEndpoint(action: QueueAction): string | null {
  return ACTION_ENDPOINTS[action as string] ?? null;
}

export type QueuedEntry = {
  id: number;
  key: string;
  action: QueueAction;
  target: string | null;
  payload: Record<string, unknown>;
  method: string;
  label: string | null;
  context: string | null;
  queuedAt: number;
  attempts: number;
  lastError?: string;
};

export type MutateOutcome =
  /** Reached the server. `response` is the real one. */
  | { kind: "sent"; response: Response }
  /** Stored in the replay queue; it will apply on reconnect. */
  | { kind: "queued"; key: string; deduped: boolean }
  /** Stored as an intent; a human has to confirm it again when back online. */
  | { kind: "intent"; key: string; deduped: boolean }
  /** Refused: this action needs a live connection (it spends tokens or streams). */
  | { kind: "unavailable"; reason: string };

export type QueueSnapshot = { writes: number; intents: number };

const listeners = new Set<(s: QueueSnapshot) => void>();
let snapshot: QueueSnapshot = { writes: 0, intents: 0 };

export function getSnapshot(): QueueSnapshot {
  return snapshot;
}

export function subscribe(fn: (s: QueueSnapshot) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function refreshSnapshot(): Promise<QueueSnapshot> {
  try {
    snapshot = await counts();
  } catch {
    // No IndexedDB (private mode, a locked-down browser): the app still works
    // online, it just cannot promise anything about offline writes.
    snapshot = { writes: 0, intents: 0 };
  }
  for (const fn of listeners) fn(snapshot);
  return snapshot;
}

/**
 * Perform a mutation, surviving a dead connection.
 *
 * Online-FIRST rather than offline-first on purpose: when the network is there,
 * the write goes straight through and the user gets the server's own answer,
 * errors included. The queue is the fallback, not the default path — a queue in
 * front of a working server just delays the truth.
 */
export async function mutate(
  action: QueueAction,
  opts: {
    target?: string | null;
    payload?: Record<string, unknown>;
    method?: string;
    endpoint?: string;
    label?: string;
    /** Shown when an intent is re-presented, e.g. "Anthropic · CV diff, 4 edits". */
    context?: string;
  } = {},
): Promise<MutateOutcome> {
  const disposition = dispositionOf(action);
  const { target = null, payload = {}, method = "POST", endpoint, label, context } = opts;

  if (disposition === "online" && !navigator.onLine) {
    return { kind: "unavailable", reason: `${labelOf(action)} needs a live connection.` };
  }

  // An intent is captured, never sent, even when the connection is fine — the
  // caller decides when a confirmed intent becomes a real request.
  const store = async (): Promise<MutateOutcome> => {
    try {
      const r = await enqueue({ action, target, payload, method, label, context });
      await refreshSnapshot();
      if (r.stored === "queue") await requestSync();
      return { kind: r.stored === "intent" ? "intent" : "queued", key: r.key, deduped: r.deduped };
    } catch (e) {
      return { kind: "unavailable", reason: e instanceof Error ? e.message : "could not queue this write" };
    }
  };

  if (!navigator.onLine) return store();

  const url = endpoint ?? actionEndpoint(action);
  if (!url) return store();

  try {
    const response = await fetch(url, {
      method,
      // Sent on the online path as well as on replay, so the header is present
      // for EVERY mutation and the server can begin de-duplicating without a
      // client change. Deterministic, so a double-tap carries the same key.
      headers: { "Content-Type": "application/json", "X-Idempotency-Key": idempotencyKey(action, target, payload) },
      body: JSON.stringify(payload),
    });
    return { kind: "sent", response };
  } catch {
    // A thrown fetch is a transport failure (offline, server down) — exactly the
    // case the queue exists for. An HTTP error is NOT: that reached the server
    // and is returned as `sent` so the caller can show the real message.
    if (disposition === "online") {
      return { kind: "unavailable", reason: `${labelOf(action)} could not reach the server.` };
    }
    return store();
  }
}

export async function pendingWrites(): Promise<QueuedEntry[]> {
  try {
    return (await listWrites()) as QueuedEntry[];
  } catch {
    return [];
  }
}

export async function pendingIntents(): Promise<QueuedEntry[]> {
  try {
    return (await listIntents()) as QueuedEntry[];
  } catch {
    return [];
  }
}

/** Discard an intent the user declined on re-presentation. */
export async function discardIntent(id: number): Promise<void> {
  await removeIntent(id);
  await refreshSnapshot();
}

/**
 * Send an intent the user has re-confirmed against live state, then drop it.
 * Note this goes through a normal fetch — the intent's payload is re-submitted
 * only because a human just looked at it again.
 */
export async function confirmIntent(entry: QueuedEntry): Promise<Response | null> {
  const url = actionEndpoint(entry.action);
  if (!url) {
    await discardIntent(entry.id);
    return null;
  }
  const res = await fetch(url, {
    method: entry.method || "POST",
    headers: { "Content-Type": "application/json", "X-Idempotency-Key": entry.key },
    body: JSON.stringify(entry.payload ?? {}),
  });
  if (res.ok) await discardIntent(entry.id);
  return res;
}

/** Ask the browser to wake the worker when the connection is back. */
async function requestSync(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.ready;
    // SyncManager is Chromium-only; Safari and Firefox fall through to the
    // `online` listener in the provider, which asks the worker directly.
    const sync = (reg as ServiceWorkerRegistration & { sync?: { register: (t: string) => Promise<void> } })?.sync;
    if (sync) await sync.register(SYNC_TAG);
  } catch {
    /* no Background Sync — the online listener covers it */
  }
}

/**
 * Replay now. Prefers the service worker (one replayer, so two tabs cannot
 * both push the same entry); falls back to replaying in-page when there is no
 * controller yet — a first visit that went offline before the worker activated.
 */
export async function replayNow(): Promise<void> {
  const controller = navigator.serviceWorker?.controller;
  if (controller) {
    controller.postMessage({ type: "replay-queue" });
    return;
  }
  try {
    await replayAll((url: string, init: RequestInit) => fetch(url, init));
  } finally {
    await refreshSnapshot();
  }
}
