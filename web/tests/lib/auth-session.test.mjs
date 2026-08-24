// Tests for web/src/lib/auth/session.mjs — session cookie read/write on
// plain Request objects.
//
// Run:  node --test tests/lib/auth-session.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase, _resetForTest, createUser } from "../../src/lib/auth/db.mjs";
import { SESSION_COOKIE, readSessionToken, getSessionUser, loginCookie, logoutCookie } from "../../src/lib/auth/session.mjs";

function fakeRequest(cookieHeader) {
  return { headers: { get: (name) => (name.toLowerCase() === "cookie" ? cookieHeader ?? null : null) } };
}

test("readSessionToken finds the cookie among several others", () => {
  const req = fakeRequest(`theme=dark; ${SESSION_COOKIE}=abc123; other=1`);
  assert.equal(readSessionToken(req), "abc123");
});

test("readSessionToken decodes a URL-encoded value", () => {
  const req = fakeRequest(`${SESSION_COOKIE}=${encodeURIComponent("a b/c")}`);
  assert.equal(readSessionToken(req), "a b/c");
});

test("readSessionToken returns null when the cookie header is absent or the cookie isn't present", () => {
  assert.equal(readSessionToken(fakeRequest(undefined)), null);
  assert.equal(readSessionToken(fakeRequest("theme=dark; other=1")), null);
});

test("loginCookie's Set-Cookie value round-trips through readSessionToken back to the right user", () => {
  _resetForTest(openDatabase(":memory:"));
  const u = createUser("cookie@example.com", "correcthorsebattery");
  const setCookieValue = loginCookie(u.id);
  // Simulate a browser: take just the "name=value" part back out as a Cookie header.
  const nameValue = setCookieValue.split(";")[0];
  const req = fakeRequest(nameValue);
  const found = getSessionUser(req);
  assert.deepEqual(found, { id: u.id, email: "cookie@example.com" });
});

test("loginCookie sets HttpOnly and SameSite=Lax", () => {
  _resetForTest(openDatabase(":memory:"));
  const u = createUser("attrs@example.com", "correcthorsebattery");
  const value = loginCookie(u.id);
  assert.match(value, /HttpOnly/);
  assert.match(value, /SameSite=Lax/);
});

test("logoutCookie clears the cookie (Max-Age=0) and invalidates the session server-side", () => {
  _resetForTest(openDatabase(":memory:"));
  const u = createUser("logout@example.com", "correcthorsebattery");
  const loginValue = loginCookie(u.id);
  const nameValue = loginValue.split(";")[0];
  const loggedInReq = fakeRequest(nameValue);
  assert.ok(getSessionUser(loggedInReq), "session works before logout");

  const logoutValue = logoutCookie(loggedInReq);
  assert.match(logoutValue, /Max-Age=0/);
  // Same token, now deleted server-side — must no longer resolve to a user.
  assert.equal(getSessionUser(loggedInReq), null);
});

test("getSessionUser returns null for a request with no session at all", () => {
  _resetForTest(openDatabase(":memory:"));
  assert.equal(getSessionUser(fakeRequest(undefined)), null);
});
