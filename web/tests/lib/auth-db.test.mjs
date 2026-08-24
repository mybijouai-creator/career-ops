// Tests for web/src/lib/auth/db.mjs — the accounts store (users, sessions,
// per-user encrypted API keys). Runs against a fresh in-memory SQLite
// database per test via openDatabase(":memory:") + _resetForTest, so tests
// never touch a real file and can't leak state into each other.
//
// Run:  node --test tests/lib/auth-db.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  openDatabase,
  _resetForTest,
  createUser,
  verifyCredentials,
  findUserById,
  createSession,
  findSessionUser,
  deleteSession,
  setApiKey,
  getApiKeySecret,
  getApiKeyInfo,
  deleteApiKey,
  AuthError,
} from "../../src/lib/auth/db.mjs";

const MASTER_KEY = Buffer.alloc(32, 7); // fixed, deterministic — test-only

function freshDb() {
  const instance = openDatabase(":memory:");
  _resetForTest(instance);
  return instance;
}

test("createUser then verifyCredentials round-trips with the right password", () => {
  freshDb();
  const u = createUser("Jane@Example.com", "correcthorsebattery");
  assert.equal(u.email, "jane@example.com", "email is normalized to lowercase");
  const verified = verifyCredentials("jane@example.com", "correcthorsebattery");
  assert.ok(verified);
  assert.equal(verified.id, u.id);
});

test("verifyCredentials rejects a wrong password", () => {
  freshDb();
  createUser("a@b.com", "correcthorsebattery");
  assert.equal(verifyCredentials("a@b.com", "wrongpassword"), null);
});

test("verifyCredentials returns null (not an error) for an unknown email — same shape as a wrong password", () => {
  freshDb();
  assert.equal(verifyCredentials("nobody@nowhere.com", "whatever1"), null);
});

test("createUser rejects a duplicate email (case-insensitively)", () => {
  freshDb();
  createUser("dup@example.com", "correcthorsebattery");
  assert.throws(() => createUser("DUP@example.com", "anotherpassword"), (e) => e instanceof AuthError && e.code === "email_taken");
});

test("createUser rejects an invalid email and a short password", () => {
  freshDb();
  assert.throws(() => createUser("not-an-email", "correcthorsebattery"), (e) => e.code === "invalid_email");
  assert.throws(() => createUser("ok@example.com", "short"), (e) => e.code === "weak_password");
});

test("findUserById returns the user without the password hash, or null", () => {
  freshDb();
  const u = createUser("find@example.com", "correcthorsebattery");
  const found = findUserById(u.id);
  assert.deepEqual(found, { id: u.id, email: "find@example.com" });
  assert.equal(findUserById("no-such-id"), null);
});

test("a created session resolves back to its user", () => {
  freshDb();
  const u = createUser("sess@example.com", "correcthorsebattery");
  const token = createSession(u.id);
  const found = findSessionUser(token);
  assert.deepEqual(found, { id: u.id, email: "sess@example.com" });
});

test("an unknown session token resolves to null", () => {
  freshDb();
  assert.equal(findSessionUser("not-a-real-token"), null);
  assert.equal(findSessionUser(""), null);
  assert.equal(findSessionUser(undefined), null);
});

test("an expired session is rejected and cleaned up (won't resolve again even if re-inserted expired)", () => {
  const instance = freshDb();
  const u = createUser("expired@example.com", "correcthorsebattery");
  // Insert an already-expired session directly (createSession always sets a
  // future expiry, so this reaches past it to exercise the expiry branch).
  const token = "deadbeef".repeat(8);
  instance.prepare("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(token, u.id, Date.now() - 1000, Date.now() - 1);
  assert.equal(findSessionUser(token), null);
  // Opportunistic GC: the expired row is gone, not just skipped.
  const row = instance.prepare("SELECT token FROM sessions WHERE token = ?").get(token);
  assert.equal(row, undefined);
});

test("deleteSession invalidates the token immediately", () => {
  freshDb();
  const u = createUser("logout@example.com", "correcthorsebattery");
  const token = createSession(u.id);
  assert.ok(findSessionUser(token));
  deleteSession(token);
  assert.equal(findSessionUser(token), null);
});

test("setApiKey then getApiKeySecret round-trips the plaintext key", () => {
  freshDb();
  const u = createUser("key@example.com", "correcthorsebattery");
  setApiKey(u.id, "anthropic", "sk-ant-real-secret-value", MASTER_KEY);
  const secret = getApiKeySecret(u.id, MASTER_KEY);
  assert.deepEqual(secret, { provider: "anthropic", key: "sk-ant-real-secret-value" });
});

test("getApiKeyInfo never exposes the plaintext or ciphertext — only a mask", () => {
  freshDb();
  const u = createUser("mask@example.com", "correcthorsebattery");
  setApiKey(u.id, "openai", "sk-openai-abcdef1234", MASTER_KEY);
  const info = getApiKeyInfo(u.id, MASTER_KEY);
  assert.equal(info.hasKey, true);
  assert.equal(info.provider, "openai");
  assert.equal(info.masked, "****1234");
  assert.equal(JSON.stringify(info).includes("sk-openai"), false, "plaintext must never appear in the client-safe info object");
});

test("getApiKeyInfo reports hasKey:false when nothing is stored", () => {
  freshDb();
  const u = createUser("nokey@example.com", "correcthorsebattery");
  assert.deepEqual(getApiKeyInfo(u.id, MASTER_KEY), { hasKey: false });
});

test("setApiKey on the same user twice replaces the key (upsert, not a duplicate row)", () => {
  const instance = freshDb();
  const u = createUser("rotate@example.com", "correcthorsebattery");
  setApiKey(u.id, "anthropic", "sk-first-key-value", MASTER_KEY);
  setApiKey(u.id, "anthropic", "sk-second-key-value", MASTER_KEY);
  const count = instance.prepare("SELECT COUNT(*) as n FROM api_keys WHERE user_id = ?").get(u.id);
  assert.equal(count.n, 1);
  assert.equal(getApiKeySecret(u.id, MASTER_KEY).key, "sk-second-key-value");
});

test("deleteApiKey removes the row entirely", () => {
  freshDb();
  const u = createUser("del@example.com", "correcthorsebattery");
  setApiKey(u.id, "anthropic", "sk-value", MASTER_KEY);
  deleteApiKey(u.id);
  assert.equal(getApiKeySecret(u.id, MASTER_KEY), null);
});

test("two users' API keys never cross — each decrypts only their own", () => {
  freshDb();
  const alice = createUser("alice@example.com", "correcthorsebattery");
  const bob = createUser("bob@example.com", "correcthorsebattery");
  setApiKey(alice.id, "anthropic", "sk-alice-key", MASTER_KEY);
  setApiKey(bob.id, "openai", "sk-bob-key", MASTER_KEY);
  assert.equal(getApiKeySecret(alice.id, MASTER_KEY).key, "sk-alice-key");
  assert.equal(getApiKeySecret(bob.id, MASTER_KEY).key, "sk-bob-key");
});
