/**
 * queue-db.mjs — the IndexedDB half of the offline write queue.
 *
 * `indexedDB` exists in both a window and a ServiceWorkerGlobalScope, so this
 * one module serves the page (enqueue, list, drop) and the service worker
 * (replay from a Background Sync event, with no page open). Promise wrappers
 * only — the rules about WHAT may be enqueued or replayed live in
 * queue-core.mjs, and this file never second-guesses them.
 */

import {
  DB_NAME,
  DB_VERSION,
  STORE_WRITES,
  STORE_INTENTS,
  dispositionOf,
  idempotencyKey,
  replayRequest,
} from "./queue-core.mjs";

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_WRITES)) {
        const s = db.createObjectStore(STORE_WRITES, { keyPath: "id", autoIncrement: true });
        // Unique on the idempotency key: the dedup is enforced by the store, not
        // by a read-then-write in the caller, so two taps racing each other
        // cannot both land.
        s.createIndex("key", "key", { unique: true });
        s.createIndex("queuedAt", "queuedAt");
      }
      if (!db.objectStoreNames.contains(STORE_INTENTS)) {
        const s = db.createObjectStore(STORE_INTENTS, { keyPath: "id", autoIncrement: true });
        s.createIndex("key", "key", { unique: true });
        s.createIndex("queuedAt", "queuedAt");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    let out;
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
    try {
      out = fn(t.objectStore(store));
    } catch (e) {
      reject(e);
    }
  });
}

const wrap = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const storeFor = (action) => (dispositionOf(action) === "intent" ? STORE_INTENTS : STORE_WRITES);

/**
 * Record a mutation made while offline.
 *
 * `queue` actions land in the replay store; `intent` actions land in the
 * re-confirm store. An `online` action is refused outright — there is nothing
 * useful to persist for a run that spends tokens.
 *
 * @returns {Promise<{stored: "queue"|"intent", key: string, deduped: boolean}>}
 */
export async function enqueue({ action, target, payload, method = "POST", label, context }) {
  const disposition = dispositionOf(action);
  if (disposition === "online") {
    throw new Error(`${action} cannot be queued offline — it needs a live connection`);
  }
  const key = idempotencyKey(action, target, payload);
  const db = await open();
  const store = storeFor(action);
  try {
    const existing = await tx(db, store, "readonly", (s) => wrap(s.index("key").get(key)));
    if (existing) return { stored: disposition, key, deduped: true };
    // The read above is a fast path, not the guarantee: two taps racing each
    // other both pass it. The unique `key` index is what actually enforces the
    // dedup, and its ConstraintError means "already queued" — a success for the
    // caller, not a failed write.
    try {
      await tx(db, store, "readwrite", (s) =>
        wrap(
          s.add({
            key,
            action,
            target: target ?? null,
            payload: payload ?? {},
            method,
            label: label ?? null,
            // Free-text context shown when an intent is re-presented, e.g. which
            // company and which diff the approval belonged to.
            context: context ?? null,
            queuedAt: Date.now(),
            attempts: 0,
          }),
        ),
      );
    } catch (e) {
      if (e && e.name === "ConstraintError") return { stored: disposition, key, deduped: true };
      throw e;
    }
    return { stored: disposition, key, deduped: false };
  } finally {
    db.close();
  }
}

/** Everything waiting to replay, oldest first. */
export async function listWrites() {
  const db = await open();
  try {
    return (await tx(db, STORE_WRITES, "readonly", (s) => wrap(s.getAll()))) ?? [];
  } finally {
    db.close();
  }
}

/** Everything waiting for a human to re-confirm, oldest first. */
export async function listIntents() {
  const db = await open();
  try {
    return (await tx(db, STORE_INTENTS, "readonly", (s) => wrap(s.getAll()))) ?? [];
  } finally {
    db.close();
  }
}

export async function counts() {
  const [writes, intents] = await Promise.all([listWrites(), listIntents()]);
  return { writes: writes.length, intents: intents.length };
}

export async function removeWrite(id) {
  const db = await open();
  try {
    await tx(db, STORE_WRITES, "readwrite", (s) => wrap(s.delete(id)));
  } finally {
    db.close();
  }
}

export async function removeIntent(id) {
  const db = await open();
  try {
    await tx(db, STORE_INTENTS, "readwrite", (s) => wrap(s.delete(id)));
  } finally {
    db.close();
  }
}

async function bumpAttempt(id, error) {
  const db = await open();
  try {
    await tx(db, STORE_WRITES, "readwrite", (s) => {
      const get = s.get(id);
      get.onsuccess = () => {
        const row = get.result;
        if (!row) return;
        row.attempts = (row.attempts || 0) + 1;
        row.lastError = String(error).slice(0, 300);
        row.lastAttemptAt = Date.now();
        s.put(row);
      };
      return wrap(get);
    });
  } finally {
    db.close();
  }
}

/** Give up on an entry the server has definitively rejected, rather than
 *  retrying a 4xx forever on every reconnect. */
const MAX_ATTEMPTS = 5;

/**
 * Replay the queued writes in order. Intents are NOT touched — this function
 * cannot reach that store at all.
 *
 * Stops at the first entry that fails for a reason that looks transient, so a
 * dependent sequence (advance to Interview, then log the follow-up) is never
 * applied out of order. A 4xx is treated as final: the server understood and
 * refused, and retrying will refuse again.
 *
 * @param {(url: string, init: RequestInit) => Promise<Response>} doFetch
 * @returns {Promise<{replayed: number, failed: number, remaining: number}>}
 */
export async function replayAll(doFetch = fetch) {
  const entries = (await listWrites()).sort((a, b) => a.queuedAt - b.queuedAt);
  let replayed = 0;
  let failed = 0;
  for (const entry of entries) {
    const req = replayRequest(entry);
    if (!req) {
      // Not replayable and yet in the replay store: drop it rather than leave a
      // permanently stuck head-of-line entry.
      await removeWrite(entry.id);
      continue;
    }
    let res;
    try {
      res = await doFetch(req.url, req.init);
    } catch (e) {
      await bumpAttempt(entry.id, e instanceof Error ? e.message : e);
      failed++;
      break; // offline again — keep order, try the whole queue next time
    }
    if (res.ok) {
      await removeWrite(entry.id);
      replayed++;
      continue;
    }
    if (res.status >= 400 && res.status < 500) {
      await bumpAttempt(entry.id, `HTTP ${res.status}`);
      if ((entry.attempts || 0) + 1 >= MAX_ATTEMPTS) await removeWrite(entry.id);
      failed++;
      continue; // a refusal is this entry's problem, not the queue's
    }
    await bumpAttempt(entry.id, `HTTP ${res.status}`);
    failed++;
    break; // 5xx: the server is unwell, stop pushing
  }
  const { writes: remaining } = await counts();
  return { replayed, failed, remaining };
}
