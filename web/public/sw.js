/**
 * sw.js — the career-ops service worker.
 *
 * A MODULE worker (registered with `{ type: "module" }`) so it can import the
 * same policy files the app bundle uses instead of carrying a second copy of
 * the rules. Two jobs, and nothing else:
 *
 *   1. Serve the app offline, per the strategy table in pwa/cache-policy.mjs.
 *   2. Replay the offline write queue when Background Sync fires — writes only,
 *      never an approval intent (pwa/queue-core.mjs is what enforces that).
 *
 * It deliberately does NOT: cache any mutation, synthesise a success response
 * for a failed write, or decide anything about gates. A write that cannot reach
 * the server fails loudly so the page can queue it and say so.
 */

import { STRATEGY, strategyFor, withinFallbackWindow } from "./pwa/cache-policy.mjs";
import { SYNC_TAG } from "./pwa/queue-core.mjs";
import { replayAll, counts } from "./pwa/queue-db.mjs";

// Bump to invalidate every cache at once. The version is part of the cache
// names, so activate() can drop anything that is not the current generation.
const VERSION = "v1";
const SHELL_CACHE = `career-ops-shell-${VERSION}`;
const DATA_CACHE = `career-ops-data-${VERSION}`;
const OFFLINE_URL = "/offline";

/** The minimum set that makes a cold, offline launch render something real
 *  rather than the browser's dinosaur. Kept small on purpose: Next's hashed
 *  assets are picked up by the cache-first rule as they are requested. */
const PRECACHE = [OFFLINE_URL, "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

// Header stamped on cached network-first responses so the 24h fallback window
// can be evaluated at read time (Response has no mutable timestamp of its own).
const CACHED_AT = "x-career-ops-cached-at";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Individually, not addAll: one 404 in the list must not fail the whole
      // install and leave the app with no worker at all.
      await Promise.all(
        PRECACHE.map(async (url) => {
          try {
            await cache.add(new Request(url, { cache: "reload" }));
          } catch {
            /* a missing precache entry degrades offline, it doesn't break install */
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, DATA_CACHE]);
      await Promise.all((await caches.keys()).map((k) => (keep.has(k) ? null : caches.delete(k))));
      // Enable navigation preload where supported: the network request for a
      // document starts before this worker has even booted.
      if (self.registration.navigationPreload) {
        try {
          await self.registration.navigationPreload.enable();
        } catch {
          /* not supported — the plain fetch path below still works */
        }
      }
      await self.clients.claim();
    })(),
  );
});

/** Cache-first: hashed immutable assets. */
async function cacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.type !== "opaque") cache.put(request, res.clone());
  return res;
}

/** Stale-while-revalidate: paint the cached copy, refresh behind it. */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(DATA_CACHE);
  const hit = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, stamp(res.clone()));
      return res;
    })
    .catch(() => null);
  if (hit) {
    // Do not await: the whole point is that the cached copy paints now.
    network.catch(() => {});
    return hit;
  }
  const res = await network;
  return res ?? new Response(JSON.stringify({ offline: true }), { status: 503, headers: { "Content-Type": "application/json" } });
}

/** Network-first with a bounded fallback: live numbers, or a cached copy for up
 *  to 24h, or an explicit 503. A spend figure of unknown age is worse than none. */
async function networkFirst(request) {
  const cache = await caches.open(DATA_CACHE);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, stamp(res.clone()));
    return res;
  } catch {
    const hit = await cache.match(request);
    if (hit) {
      const cachedAt = Number(hit.headers.get(CACHED_AT));
      if (withinFallbackWindow(cachedAt, Date.now())) return hit;
      await cache.delete(request);
    }
    return new Response(JSON.stringify({ offline: true, stale: true }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}

/** Documents: always try the network, fall back to the last good copy of THIS
 *  route, then to the offline shell. */
async function navigation(request, preloadResponse) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = (await preloadResponse) || (await fetch(request));
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    const hit = (await cache.match(request)) || (await cache.match(OFFLINE_URL));
    return (
      hit ??
      new Response("<h1>Offline</h1><p>career-ops has nothing cached for this route yet.</p>", {
        status: 503,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      })
    );
  }
}

/** Re-wrap a response with the cache timestamp the 24h window is measured from. */
function stamp(res) {
  const headers = new Headers(res.headers);
  headers.set(CACHED_AT, String(Date.now()));
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // Cross-origin (a company logo, a font) is left entirely alone: this is a
  // local-first app and the SW has no business shadowing third-party responses.
  if (new URL(request.url).origin !== self.location.origin) return;

  const isNavigation = request.mode === "navigate";
  const strategy = strategyFor(request.url, request.method, isNavigation);

  switch (strategy) {
    case STRATEGY.CACHE_FIRST:
      event.respondWith(cacheFirst(request));
      return;
    case STRATEGY.SWR:
      event.respondWith(staleWhileRevalidate(request));
      return;
    case STRATEGY.NETWORK_FIRST:
      event.respondWith(networkFirst(request));
      return;
    case STRATEGY.NAVIGATION:
      event.respondWith(navigation(request, event.preloadResponse));
      return;
    default:
      // STRATEGY.NEVER — including every mutation. Do not call respondWith at
      // all: the request goes to the network exactly as the page issued it, and
      // a failure surfaces to the page as a real failure. Faking an ok here is
      // what would let a stale write look applied.
      return;
  }
});

// ── Offline write queue replay ─────────────────────────────────────────────
//
// Background Sync wakes the worker when connectivity returns, with or without a
// page open. Only the `writes` store is replayed; approval intents are left
// where they are for the UI to re-present against live state.

async function runReplay() {
  const result = await replayAll((url, init) => fetch(url, init));
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: "window" });
  const { writes, intents } = await counts();
  for (const client of clients) {
    client.postMessage({ type: "queue-replayed", ...result, pending: writes, intents });
  }
  return result;
}

self.addEventListener("sync", (event) => {
  if (event.tag !== SYNC_TAG) return;
  // Reject on a non-empty queue so the browser retries this sync with its own
  // backoff instead of us hand-rolling a retry timer.
  event.waitUntil(
    runReplay().then((r) => {
      if (r.remaining > 0) throw new Error(`${r.remaining} write(s) still queued`);
    }),
  );
});

// A page can ask for a replay directly — the reconnect path when Background Sync
// is unavailable (Safari has no SyncManager).
self.addEventListener("message", (event) => {
  if (event.data?.type === "replay-queue") event.waitUntil(runReplay());
  if (event.data?.type === "skip-waiting") self.skipWaiting();
});

// ── Push ──────────────────────────────────────────────────────────────────
//
// The four notification kinds from HANDOFF §7b (gate opened, worker finished,
// follow-up due, posting closed) and the route each action opens. There is no
// push SERVER in this repo yet — no VAPID keys, no subscription endpoint — so
// nothing sends these today; the handler is here so that when a sender exists
// the client half is already correct, and so `notificationclick` routing is
// testable by dispatching a push event from devtools.
//
// Gate notifications deliberately carry no diff content: the payload names the
// gate, and the diff is read from the app against live state.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "career-ops", body: event.data?.text?.() ?? "" };
  }
  const kind = data.kind ?? "info";
  event.waitUntil(
    self.registration.showNotification(data.title ?? "career-ops", {
      body: data.body ?? "",
      icon: "/icons/icon-192.png",
      badge: "/icons/maskable-192.png",
      tag: data.tag ?? kind,
      data: { url: data.url ?? "/", kind },
      actions: data.actions ?? [],
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.action || event.notification.data?.url || "/";
  const url = target.startsWith("/") ? target : "/";
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ includeUncontrolled: true, type: "window" });
      const existing = clients.find((c) => new URL(c.url).origin === self.location.origin);
      if (existing) {
        await existing.focus();
        existing.postMessage({ type: "navigate", url });
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
