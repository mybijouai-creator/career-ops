/**
 * cache-policy.mjs — which caching strategy a request gets, as pure functions.
 *
 * Lives in `public/pwa/` on purpose: it is imported BOTH by the module service
 * worker (which can only fetch statically-served URLs) and by the app bundle via
 * the `@pwa/*` tsconfig alias, so the policy the SW enforces and the policy the
 * UI explains to the user can never drift. `node --test` imports it by relative
 * path. No SW/DOM globals and no side effects — everything here is a function of
 * (url, method).
 *
 * The strategy table is HANDOFF.md §7b, mapped onto the routes this app actually
 * has (the handoff's `/api/roles` shell does not exist yet; `/api/pipeline` is
 * the tracker+inbox read that plays its part):
 *
 *   handoff row                              →  this app
 *   app shell                                →  precache, cache-first
 *   GET /api/roles, /api/roles/:id/report    →  GET /api/pipeline, /api/report/*
 *   GET /api/prep/*                          →  (not built — no route yet)
 *   output/*.pdf                             →  GET /api/cv-pdf
 *   GET /api/analytics/*                     →  GET /api/usage  (cost ledger)
 *   any POST                                 →  never
 */

/** Strategy names. `navigation` is network-first with a cached-document fallback
 *  and finally the offline shell, so a launch with no network still opens. */
export const STRATEGY = {
  CACHE_FIRST: "cache-first",
  SWR: "stale-while-revalidate",
  NETWORK_FIRST: "network-first",
  NAVIGATION: "navigation",
  NEVER: "never",
};

/** Network-first responses are served from cache past their network failure for
 *  this long, then treated as too stale to show (HANDOFF: "24h fallback"). */
export const NETWORK_FIRST_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Read-only data reads worth having offline: the pipeline, the evaluation
 *  reports, and the settings/profile surfaces. Stale-while-revalidate — the
 *  cached copy paints immediately, the network refreshes it behind the paint. */
const SWR_PREFIXES = [
  "/api/pipeline",
  "/api/report",
  "/api/followups",
  "/api/profile",
  "/api/portals",
  "/api/cv",
  "/api/cv-pdf",
  "/api/clis",
  "/api/version",
  "/api/whats-new",
  "/api/doctor",
  "/api/memory",
  "/api/logo",
];

/** Spend/analytics: always prefer live numbers, fall back to a cached copy for
 *  24h. A stale cost ledger is useful; a wrong-and-undated one is not. */
const NETWORK_FIRST_PREFIXES = ["/api/usage", "/api/analytics"];

/**
 * Endpoints that must never be served from — or written to — the cache even on
 * GET. These stream (ndjson/SSE) or spend money, and a replayed stream is worse
 * than no stream: it would show a completed run that never happened.
 */
const NEVER_PREFIXES = ["/api/run", "/api/runs", "/api/explore", "/api/assistant", "/api/apply", "/api/status", "/api/tracker"];

const startsWithSegment = (pathname, prefix) =>
  pathname === prefix || pathname.startsWith(prefix + "/") || pathname.startsWith(prefix + "?");

/**
 * The strategy for one request.
 * @param {string} rawUrl absolute or root-relative request URL
 * @param {string} [method] HTTP method (default GET)
 * @param {boolean} [isNavigation] true for a document request
 * @returns {string} one of STRATEGY
 */
export function strategyFor(rawUrl, method = "GET", isNavigation = false) {
  // Rule 4 of the handoff invariants, and the one that must never have an
  // exception: a mutation is never cached. Anything non-GET goes to the network
  // (and, when that fails, to the offline write queue — never to a cache).
  const m = String(method || "GET").toUpperCase();
  if (m !== "GET" && m !== "HEAD") return STRATEGY.NEVER;

  let pathname = "";
  try {
    pathname = new URL(rawUrl, "http://localhost").pathname;
  } catch {
    return STRATEGY.NEVER;
  }

  if (NEVER_PREFIXES.some((p) => startsWithSegment(pathname, p))) return STRATEGY.NEVER;
  if (NETWORK_FIRST_PREFIXES.some((p) => startsWithSegment(pathname, p))) return STRATEGY.NETWORK_FIRST;
  if (SWR_PREFIXES.some((p) => startsWithSegment(pathname, p))) return STRATEGY.SWR;

  // A document request: the user is opening a route. Never hand back a cached
  // page when the network is up (the tracker changes under us), but always have
  // one to hand back when it isn't.
  if (isNavigation) return STRATEGY.NAVIGATION;

  // Build output and static assets are content-hashed by Next, so they are
  // immutable and safe to serve from cache without revalidating.
  if (
    pathname.startsWith("/_next/static/") ||
    pathname.startsWith("/icons/") ||
    pathname.startsWith("/pwa/") ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/apple-touch-icon.png" ||
    /\.(?:css|js|mjs|woff2?|ttf|otf|png|jpg|jpeg|svg|webp|avif|ico)$/.test(pathname)
  ) {
    return STRATEGY.CACHE_FIRST;
  }

  // Anything else unrecognised (an API route added after this policy was
  // written) goes to the network untouched. Failing open on caching is the safe
  // default: a missed cache costs a round trip, a wrong cache shows fiction.
  return STRATEGY.NEVER;
}

/** Whether a cached network-first response is still inside the 24h window. */
export function withinFallbackWindow(cachedAtMs, nowMs, maxAgeMs = NETWORK_FIRST_MAX_AGE_MS) {
  if (!Number.isFinite(cachedAtMs)) return false;
  return nowMs - cachedAtMs <= maxAgeMs;
}
