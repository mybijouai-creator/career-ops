// The service worker's caching rules are a security-adjacent contract, not a
// perf tweak: the one thing that must never happen is a mutation being served
// from — or written to — a cache, because a replayed write looks applied when
// nothing was written. These assert the rules directly on the shared module the
// SW imports, so the SW and the app cannot diverge from what is tested here.
//
// Run:  node --test tests/lib/pwa-cache-policy.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STRATEGY,
  NETWORK_FIRST_MAX_AGE_MS,
  strategyFor,
  withinFallbackWindow,
} from "../../public/pwa/cache-policy.mjs";

test("no mutation is ever cacheable, whatever the path", () => {
  const paths = ["/api/status", "/api/pipeline", "/api/profile", "/", "/_next/static/x.js", "/icons/icon-192.png"];
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "post", "delete"]) {
    for (const path of paths) {
      assert.equal(strategyFor(path, method), STRATEGY.NEVER, `${method} ${path} must never be cached`);
    }
  }
});

test("read-only data reads are stale-while-revalidate", () => {
  for (const p of ["/api/pipeline", "/api/report/shape", "/api/followups", "/api/followups/cadence", "/api/profile", "/api/cv-pdf"]) {
    assert.equal(strategyFor(p), STRATEGY.SWR, p);
  }
});

test("spend and analytics are network-first, so a stale cost is never shown as live", () => {
  assert.equal(strategyFor("/api/usage"), STRATEGY.NETWORK_FIRST);
  assert.equal(strategyFor("/api/analytics/funnel"), STRATEGY.NETWORK_FIRST);
});

test("streaming and token-spending endpoints are never cached even on GET", () => {
  // A cached ndjson/SSE body would replay a run that never happened.
  for (const p of ["/api/run", "/api/runs/save", "/api/explore", "/api/assistant", "/api/apply/prefill", "/api/status", "/api/tracker/delete"]) {
    assert.equal(strategyFor(p, "GET"), STRATEGY.NEVER, p);
  }
});

test("hashed build output and icons are cache-first", () => {
  for (const p of ["/_next/static/chunks/main.js", "/icons/maskable-512.png", "/apple-touch-icon.png", "/manifest.webmanifest", "/pwa/queue-core.mjs", "/fonts/x.woff2"]) {
    assert.equal(strategyFor(p), STRATEGY.CACHE_FIRST, p);
  }
});

test("document requests use the navigation strategy, not a data strategy", () => {
  for (const p of ["/", "/explore", "/jobs/247", "/prep", "/agent"]) {
    assert.equal(strategyFor(p, "GET", true), STRATEGY.NAVIGATION, p);
  }
  // The navigation flag must not override an explicit never-cache rule: a
  // document request at a streaming path is still not cacheable.
  assert.equal(strategyFor("/api/run", "GET", true), STRATEGY.NEVER);
});

test("an unrecognised API route fails OPEN to the network rather than being cached", () => {
  // Failing open costs a round trip; failing closed would show fiction from a
  // route this policy predates.
  assert.equal(strategyFor("/api/some-route-added-later"), STRATEGY.NEVER);
});

test("a prefix match is anchored at a segment boundary", () => {
  // "/api/usagestats" is a DIFFERENT route from "/api/usage" and must not
  // inherit its strategy.
  assert.equal(strategyFor("/api/usagestats"), STRATEGY.NEVER);
  assert.equal(strategyFor("/api/pipelinex"), STRATEGY.NEVER);
  // …but a real child path does inherit it.
  assert.equal(strategyFor("/api/pipeline/anything"), STRATEGY.SWR);
});

test("a malformed URL is not cached", () => {
  assert.equal(strategyFor("::::"), STRATEGY.NEVER);
  assert.equal(strategyFor(""), STRATEGY.NEVER);
});

test("the network-first fallback window is exactly 24h", () => {
  const now = 1_700_000_000_000;
  assert.equal(NETWORK_FIRST_MAX_AGE_MS, 24 * 60 * 60 * 1000);
  assert.equal(withinFallbackWindow(now, now), true);
  assert.equal(withinFallbackWindow(now - NETWORK_FIRST_MAX_AGE_MS, now), true, "exactly 24h old still counts");
  assert.equal(withinFallbackWindow(now - NETWORK_FIRST_MAX_AGE_MS - 1, now), false, "a millisecond past 24h is stale");
  assert.equal(withinFallbackWindow(NaN, now), false, "an unstamped cache entry is never in the window");
});
