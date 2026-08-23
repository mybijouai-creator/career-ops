/**
 * queue-core.mjs — the offline write queue's classification and identity rules.
 *
 * Same placement rationale as cache-policy.mjs: imported by the module service
 * worker (which replays the queue from Background Sync, with no page open) and
 * by the app bundle through the `@pwa/*` alias, so the client cannot enqueue
 * something under rules the replayer disagrees with. Pure — no IndexedDB, no SW
 * globals, no side effects. The IndexedDB plumbing lives in queue-db.mjs.
 *
 * The one invariant this file exists to enforce (HANDOFF.md §7b):
 *
 *   Non-gated mutations queue and replay. GATED actions never do — an offline
 *   approval is stored as an INTENT and re-presented for confirmation against
 *   live state when the connection returns, because a stale diff must not be
 *   able to write files.
 *
 * Those are two different stores with two different lifecycles, not one store
 * with a flag, so that "replay everything queued" can never accidentally reach
 * an approval.
 */

export const DB_NAME = "career-ops-pwa";
export const DB_VERSION = 1;
/** Replayable mutations, oldest first. */
export const STORE_WRITES = "writes";
/** Approvals and irreversible writes captured offline. NEVER auto-replayed. */
export const STORE_INTENTS = "intents";
/** Background Sync tag the SW listens on. */
export const SYNC_TAG = "career-ops-replay";

/**
 * Every mutation the UI can make offline, and what happens to it.
 *
 *  - `queue`  → safe to replay unattended: the write is a set-to-a-value or an
 *               append the user already decided on, and replaying it late is
 *               the behaviour they asked for.
 *  - `intent` → replaying unattended could write the wrong thing: it either
 *               overwrites a whole file from a form the user filled against
 *               state that has since moved (profile, portals, cv), or it is
 *               irreversible (tracker delete), or it is an approval gate. The
 *               user is re-asked on reconnect.
 *  - `online` → must not be attempted offline at all: it spends tokens or
 *               streams, so there is nothing useful to queue.
 */
export const ACTIONS = {
  "status-advance": { store: "queue", endpoint: "/api/status", label: "Status change" },
  "followup-log": { store: "queue", endpoint: "/api/followups/log", label: "Follow-up logged" },
  "followup-override": { store: "queue", endpoint: "/api/followups/override", label: "Follow-up date" },
  "tracker-delete": { store: "intent", endpoint: "/api/tracker/delete", label: "Remove tracker row" },
  "profile-save": { store: "intent", endpoint: "/api/profile", label: "Profile edit" },
  "portals-save": { store: "intent", endpoint: "/api/portals", label: "Portals edit" },
  "cv-save": { store: "intent", endpoint: "/api/cv", label: "CV edit" },
  "gate-approve": { store: "intent", endpoint: null, label: "Approval gate" },
  "artifact-cv": { store: "online", endpoint: null, label: "Tailor CV" },
  "artifact-cover": { store: "online", endpoint: null, label: "Cover letter" },
  "evaluate": { store: "online", endpoint: null, label: "Evaluation" },
};

/** @returns {"queue"|"intent"|"online"} how an action is handled offline. */
export function dispositionOf(action) {
  return ACTIONS[action]?.store ?? "online";
}

/** True only for actions that may be replayed unattended. */
export function isReplayable(action) {
  return dispositionOf(action) === "queue";
}

/** True for actions that are captured but must be re-confirmed by a human. */
export function needsReconfirm(action) {
  return dispositionOf(action) === "intent";
}

export function labelOf(action) {
  return ACTIONS[action]?.label ?? action;
}

/**
 * A stable, collision-resistant idempotency key for one mutation.
 *
 * Derived from (action, target, payload) rather than from a random UUID, so the
 * SAME logical write enqueued twice while offline — the user taps Advance, the
 * optimistic UI does not stick, they tap again — collapses to one entry instead
 * of applying twice on reconnect. The random part of an entry's identity is its
 * autoincrement id; the idempotency key is deliberately deterministic.
 *
 * FNV-1a over the canonical JSON. Not cryptographic and does not need to be:
 * this only has to distinguish one user's own queued writes from each other.
 *
 * NOTE: the server does not honour `X-Idempotency-Key` yet (there is no
 * server-side dedup store — see the gate/receipt work in HANDOFF §5). What this
 * key guarantees today is client-side: the queue never holds two entries for the
 * same logical write, so a replay cannot double-apply from OUR side. The header
 * is sent so the server can start honouring it without a client change.
 */
export function idempotencyKey(action, target, payload) {
  const canonical = JSON.stringify([action, target ?? null, canonicalize(payload)]);
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // Second pass over the reversed string: one 32-bit FNV over short JSON
  // collides more than is comfortable when keys differ only in a trailing digit.
  let g = 0x811c9dc5;
  for (let i = canonical.length - 1; i >= 0; i--) {
    g ^= canonical.charCodeAt(i);
    g = Math.imul(g, 0x01000193) >>> 0;
  }
  return `${action}-${h.toString(36)}${g.toString(36)}`;
}

/** Key-sorted deep copy, so `{a:1,b:2}` and `{b:2,a:1}` hash the same. */
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = canonicalize(value[k]);
    return out;
  }
  return value === undefined ? null : value;
}

/**
 * Turn a queued entry into the request that replays it. Refuses anything that
 * is not replayable — the replayer asks this function, so a mis-stored intent
 * still cannot be sent.
 * @returns {{url: string, init: RequestInit} | null}
 */
export function replayRequest(entry) {
  if (!entry || !isReplayable(entry.action)) return null;
  const endpoint = ACTIONS[entry.action]?.endpoint;
  if (!endpoint) return null;
  return {
    url: endpoint,
    init: {
      method: entry.method || "POST",
      headers: { "Content-Type": "application/json", "X-Idempotency-Key": entry.key },
      body: JSON.stringify(entry.payload ?? {}),
    },
  };
}
