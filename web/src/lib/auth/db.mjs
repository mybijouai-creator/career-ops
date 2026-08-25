/**
 * db.mjs — the accounts store: users, sessions, and each user's own
 * encrypted provider API key. Platform-wide state (see platform-root.mjs),
 * not per-tenant career-ops data.
 *
 * Uses node:sqlite (Node 22.5+, built in — no native-module dependency to
 * carry through the Docker multi-stage build, unlike better-sqlite3). It is
 * still flagged experimental upstream; this file is the one place that
 * import lives, so upgrading off it later is a one-file change.
 *
 * One process-wide connection, opened lazily on first use and memoized —
 * SQLite handles concurrent access from one process fine, and Next's route
 * handlers all run in the same Node process in this deployment shape.
 */
import path from "node:path";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { platformRoot } from "./platform-root.mjs";
import { hashPassword, verifyPassword, randomToken, encryptSecret, decryptSecret, maskSecret } from "./crypto.mjs";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

let _db = null;

function dbPath() {
  return process.env.CAREER_OPS_ACCOUNTS_DB?.trim() || path.join(platformRoot(), "_accounts.db");
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE TABLE IF NOT EXISTS api_keys (
    user_id TEXT PRIMARY KEY REFERENCES users(id),
    provider TEXT NOT NULL,
    iv TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    auth_tag TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS login_failures (
    email TEXT PRIMARY KEY,
    count INTEGER NOT NULL,
    blocked_until INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS signup_attempts (
    ip TEXT PRIMARY KEY,
    count INTEGER NOT NULL,
    window_start INTEGER NOT NULL
  );
`;

/** Open (and migrate) a database at a path, or ":memory:" for tests. Exported
 *  so tests get the exact same schema the real file gets — one definition. */
export function openDatabase(location) {
  if (location !== ":memory:") fs.mkdirSync(path.dirname(location), { recursive: true });
  const instance = new DatabaseSync(location);
  if (location !== ":memory:") instance.exec("PRAGMA journal_mode = WAL;"); // readers don't block the (rare) writer
  instance.exec(SCHEMA);
  return instance;
}

function db() {
  if (_db) return _db;
  _db = openDatabase(dbPath());
  return _db;
}

/** Test-only: point every call in this module at a given (already-migrated)
 *  database instead of lazily opening the real file. Pass undefined/null to
 *  drop back to lazy-open-the-real-file on the next call. */
export function _resetForTest(instance) {
  _db = instance ?? null;
}

function newUserId() {
  return randomToken(16); // 128-bit, also doubles as the tenant directory name in Phase 2
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class AuthError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Create a new user. Throws AuthError("email_taken"|"invalid_email"|"weak_password"). */
export function createUser(email, password) {
  const normalized = String(email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(normalized)) throw new AuthError("invalid_email", "That doesn't look like a valid email address.");
  if (typeof password !== "string" || password.length < 8) {
    throw new AuthError("weak_password", "Password must be at least 8 characters.");
  }
  const d = db();
  const existing = d.prepare("SELECT id FROM users WHERE email = ?").get(normalized);
  if (existing) throw new AuthError("email_taken", "An account with that email already exists.");
  const id = newUserId();
  d.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)").run(
    id,
    normalized,
    hashPassword(password),
    Date.now(),
  );
  return { id, email: normalized };
}

/** Verify credentials. Returns the user (without password_hash) or null —
 *  never distinguishes "no such email" from "wrong password" to the caller,
 *  so a login form can't be used to enumerate registered emails. */
export function verifyCredentials(email, password) {
  const normalized = String(email ?? "").trim().toLowerCase();
  const row = db().prepare("SELECT id, email, password_hash FROM users WHERE email = ?").get(normalized);
  if (!row) return null;
  if (!verifyPassword(password, row.password_hash)) return null;
  return { id: row.id, email: row.email };
}

export function findUserById(id) {
  const row = db().prepare("SELECT id, email FROM users WHERE id = ?").get(String(id ?? ""));
  // node:sqlite rows are null-prototype objects — normalize to a plain object
  // literal so callers get an ordinary shape (JSON.stringify handles either
  // fine, but strict equality / spread / instanceof checks downstream don't
  // have to know about the driver's internals).
  return row ? { id: row.id, email: row.email } : null;
}

/** Create a session row and return its opaque token. */
export function createSession(userId) {
  const token = randomToken();
  const now = Date.now();
  db()
    .prepare("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .run(token, userId, now, now + SESSION_TTL_MS);
  return token;
}

/** Resolve a session token to its user, or null if missing/expired. Lazily
 *  deletes an expired row it happens to find (no background sweeper needed
 *  at this scale — every lookup is also a cheap opportunistic GC). */
export function findSessionUser(token) {
  if (!token) return null;
  const row = db().prepare("SELECT user_id, expires_at FROM sessions WHERE token = ?").get(token);
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    db().prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return null;
  }
  return findUserById(row.user_id);
}

export function deleteSession(token) {
  if (!token) return;
  db().prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

/** Store (replace) a user's provider API key, encrypted at rest. */
export function setApiKey(userId, provider, plaintextKey, masterKey) {
  const enc = encryptSecret(plaintextKey, masterKey);
  const now = Date.now();
  db()
    .prepare(
      `INSERT INTO api_keys (user_id, provider, iv, ciphertext, auth_tag, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET provider = excluded.provider, iv = excluded.iv,
         ciphertext = excluded.ciphertext, auth_tag = excluded.auth_tag, updated_at = excluded.updated_at`,
    )
    .run(userId, provider, enc.iv, enc.ciphertext, enc.authTag, now);
}

/** Decrypted key for internal use only (e.g. injecting into a spawned CLI's
 *  env in Phase 2) — never return this value to a client response. */
export function getApiKeySecret(userId, masterKey) {
  const row = db().prepare("SELECT provider, iv, ciphertext, auth_tag FROM api_keys WHERE user_id = ?").get(userId);
  if (!row) return null;
  return { provider: row.provider, key: decryptSecret({ iv: row.iv, ciphertext: row.ciphertext, authTag: row.auth_tag }, masterKey) };
}

/** Client-safe summary: never the plaintext, never even the ciphertext. */
export function getApiKeyInfo(userId, masterKey) {
  const secret = getApiKeySecret(userId, masterKey);
  if (!secret) return { hasKey: false };
  return { hasKey: true, provider: secret.provider, masked: maskSecret(secret.key) };
}

export function deleteApiKey(userId) {
  db().prepare("DELETE FROM api_keys WHERE user_id = ?").run(userId);
}

// --- Login brute-force throttle (Phase 4 security pass) ---
//
// Was an in-process Map in the route handler (Phase 1) — reset on every
// deploy/restart, and this app runs as one Node process anyway (see db.mjs's
// header), so persisting it here buys exactly the restart-resistance that
// mattered, at the same "one process" cost the rest of this file already
// accepts. Per-email exponential backoff, reset on a successful login.

const LOGIN_BASE_DELAY_MS = 1000;
const LOGIN_MAX_DELAY_MS = 30_000;

/** Milliseconds until this email may attempt another login, or 0 if not throttled. */
export function loginThrottleRemainingMs(email) {
  const normalized = String(email ?? "").trim().toLowerCase();
  const row = db().prepare("SELECT blocked_until FROM login_failures WHERE email = ?").get(normalized);
  if (!row) return 0;
  return Math.max(0, row.blocked_until - Date.now());
}

/** Record a failed login attempt, extending this email's backoff. */
export function recordLoginFailure(email) {
  const normalized = String(email ?? "").trim().toLowerCase();
  const row = db().prepare("SELECT count FROM login_failures WHERE email = ?").get(normalized);
  const count = (row?.count ?? 0) + 1;
  const blockedUntil = Date.now() + Math.min(LOGIN_MAX_DELAY_MS, LOGIN_BASE_DELAY_MS * 2 ** (count - 1));
  db()
    .prepare(
      `INSERT INTO login_failures (email, count, blocked_until) VALUES (?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET count = excluded.count, blocked_until = excluded.blocked_until`,
    )
    .run(normalized, count, blockedUntil);
}

/** Clear this email's backoff after a successful login. */
export function recordLoginSuccess(email) {
  const normalized = String(email ?? "").trim().toLowerCase();
  db().prepare("DELETE FROM login_failures WHERE email = ?").run(normalized);
}

// --- Signup rate limit (Phase 4 security pass) ---
//
// Phase 1-3 had no limit at all: an unauthenticated POST /api/auth/signup
// both writes a users row AND (once a session is established) triggers a
// full tenant directory to be provisioned on next use — a scriptable way to
// fill the volume's disk with tenant trees and bloat the accounts table.
// Fixed-window per-IP limit, generous enough not to bother a real household
// signing up a few people from behind one NAT.

const SIGNUP_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const SIGNUP_MAX_PER_WINDOW = 8;

/** Milliseconds until this IP may sign up again, or 0 if not throttled. */
export function signupThrottleRemainingMs(ip) {
  const key = String(ip ?? "unknown");
  const row = db().prepare("SELECT count, window_start FROM signup_attempts WHERE ip = ?").get(key);
  if (!row) return 0;
  const elapsed = Date.now() - row.window_start;
  if (elapsed >= SIGNUP_WINDOW_MS) return 0; // the window has rolled over
  if (row.count < SIGNUP_MAX_PER_WINDOW) return 0;
  return SIGNUP_WINDOW_MS - elapsed;
}

/** Record one signup attempt from this IP, starting a fresh window if the last one expired. */
export function recordSignupAttempt(ip) {
  const key = String(ip ?? "unknown");
  const now = Date.now();
  const row = db().prepare("SELECT count, window_start FROM signup_attempts WHERE ip = ?").get(key);
  if (!row || now - row.window_start >= SIGNUP_WINDOW_MS) {
    db()
      .prepare(
        `INSERT INTO signup_attempts (ip, count, window_start) VALUES (?, 1, ?)
         ON CONFLICT(ip) DO UPDATE SET count = 1, window_start = excluded.window_start`,
      )
      .run(key, now);
  } else {
    db().prepare("UPDATE signup_attempts SET count = count + 1 WHERE ip = ?").run(key);
  }
}
