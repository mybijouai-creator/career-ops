/**
 * crypto.mjs — password hashing and secret-at-rest encryption for the
 * multi-tenant accounts store. Node stdlib only (`node:crypto`) — no new
 * dependency, consistent with the rest of this codebase's house style.
 *
 * Two independent primitives:
 *   - Password hashing (scrypt, salted, timing-safe compare) — for login.
 *   - Secret encryption (AES-256-GCM) — for each user's own provider API
 *     key, which this app must store so background workers can spend on
 *     the user's behalf without them re-pasting it every run.
 *
 * Both are pure and side-effect free (no fs, no db) so they're directly
 * unit-testable, per this repo's "extract the logic under test into a
 * plain .mjs module" convention (see web/README.md's Tests section).
 */

import { randomBytes, scryptSync, timingSafeEqual, createCipheriv, createDecipheriv } from "node:crypto";

const SCRYPT_KEYLEN = 64;
const SCRYPT_SALT_BYTES = 16;
// scrypt's own defaults (N=16384, r=8, p=1) are already tuned for interactive
// login latency vs. brute-force cost; passing none pins Node's current
// defaults rather than silently drifting them across Node versions.
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1 };

/** Hash a plaintext password. Returns "salt:hash", both hex — one string,
 *  safe to store in a single TEXT column. */
export function hashPassword(password) {
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("hashPassword: password must be a non-empty string");
  }
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTS);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

/** Verify a plaintext password against a "salt:hash" string from hashPassword.
 *  Timing-safe: a wrong-length guess or a wrong password take the same time
 *  to reject (constant-time compare on the derived hash, not the password
 *  itself — scrypt's own cost dominates timing regardless). */
export function verifyPassword(password, stored) {
  if (typeof password !== "string" || typeof stored !== "string") return false;
  const sep = stored.indexOf(":");
  if (sep < 0) return false;
  const saltHex = stored.slice(0, sep);
  const hashHex = stored.slice(sep + 1);
  let salt, expected;
  try {
    salt = Buffer.from(saltHex, "hex");
    expected = Buffer.from(hashHex, "hex");
  } catch {
    return false;
  }
  if (salt.length !== SCRYPT_SALT_BYTES || expected.length !== SCRYPT_KEYLEN) return false;
  const actual = scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTS);
  // timingSafeEqual throws on length mismatch rather than returning false —
  // guarded above, but guard again here defensively since actual/expected
  // are independently derived.
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

const AES_ALGO = "aes-256-gcm";
const AES_IV_BYTES = 12; // 96-bit IV is the GCM-recommended size

/**
 * Read the server's master encryption key from the environment. Required in
 * multi-tenant mode — there is no default and no fallback, because a default
 * key would make every deployment's stored API keys decryptable with a key
 * published in this repo's own source.
 *
 * Format: 64 hex chars (32 bytes) — generate with
 * `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
 */
export function getMasterKey(env = process.env) {
  const raw = env.CAREER_OPS_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "CAREER_OPS_ENCRYPTION_KEY is not set. Generate one with: " +
        `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
    );
  }
  const key = Buffer.from(raw, "hex");
  if (key.length !== 32) {
    throw new Error(`CAREER_OPS_ENCRYPTION_KEY must be 64 hex chars (32 bytes) — got ${raw.length} chars`);
  }
  return key;
}

/** Encrypt a secret (e.g. a user's provider API key) for storage. Returns
 *  base64 iv/ciphertext/authTag — store all three; all three are required
 *  to decrypt, and none alone reveals the plaintext. */
export function encryptSecret(plaintext, masterKey) {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error("encryptSecret: plaintext must be a non-empty string");
  }
  const iv = randomBytes(AES_IV_BYTES);
  const cipher = createCipheriv(AES_ALGO, masterKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

/** Inverse of encryptSecret. Throws if authTag doesn't verify — a tampered
 *  or corrupted row fails loudly rather than returning garbage. */
export function decryptSecret({ iv, ciphertext, authTag }, masterKey) {
  const decipher = createDecipheriv(AES_ALGO, masterKey, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(authTag, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]);
  return plaintext.toString("utf8");
}

/** Last 4 characters of a secret, for display ("sk-ant-***1a2b") without
 *  ever round-tripping the plaintext to the client after initial submission. */
export function maskSecret(plaintext) {
  if (typeof plaintext !== "string" || plaintext.length === 0) return "";
  return plaintext.length <= 4 ? "*".repeat(plaintext.length) : `${"*".repeat(4)}${plaintext.slice(-4)}`;
}

/** Opaque random token for session ids — 256 bits, hex-encoded. */
export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("hex");
}
