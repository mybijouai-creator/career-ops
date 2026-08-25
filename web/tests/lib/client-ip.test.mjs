// Tests for web/src/lib/auth/client-ip.mjs.
//
// Run:  node --test tests/lib/client-ip.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { clientIp } from "../../src/lib/auth/client-ip.mjs";

function fakeRequest(headers) {
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { headers: { get: (name) => map.get(name.toLowerCase()) ?? null } };
}

test("clientIp: reads the first hop of X-Forwarded-For", () => {
  assert.equal(clientIp(fakeRequest({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" })), "203.0.113.9");
});

test("clientIp: falls back to X-Real-IP when X-Forwarded-For is absent", () => {
  assert.equal(clientIp(fakeRequest({ "x-real-ip": "203.0.113.10" })), "203.0.113.10");
});

test("clientIp: 'unknown' when neither header is present", () => {
  assert.equal(clientIp(fakeRequest({})), "unknown");
});

test("clientIp: trims whitespace around the first X-Forwarded-For hop", () => {
  assert.equal(clientIp(fakeRequest({ "x-forwarded-for": "  203.0.113.11  , 10.0.0.1" })), "203.0.113.11");
});
