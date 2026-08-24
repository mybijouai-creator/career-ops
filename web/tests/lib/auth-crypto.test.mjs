// Tests for web/src/lib/auth/crypto.mjs — password hashing and the
// AES-256-GCM secret-at-rest encryption used for each tenant's own
// provider API key.
//
// Run:  node --test tests/lib/auth-crypto.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hashPassword,
  verifyPassword,
  getMasterKey,
  encryptSecret,
  decryptSecret,
  maskSecret,
  randomToken,
} from "../../src/lib/auth/crypto.mjs";

test("a correct password verifies against its own hash", () => {
  const stored = hashPassword("correct horse battery staple");
  assert.equal(verifyPassword("correct horse battery staple", stored), true);
});

test("a wrong password is rejected", () => {
  const stored = hashPassword("correct horse battery staple");
  assert.equal(verifyPassword("wrong password", stored), false);
});

test("two hashes of the same password differ (random salt) but both verify", () => {
  const a = hashPassword("same password");
  const b = hashPassword("same password");
  assert.notEqual(a, b);
  assert.equal(verifyPassword("same password", a), true);
  assert.equal(verifyPassword("same password", b), true);
});

test("verifyPassword never throws on malformed stored strings", () => {
  for (const bad of ["", "no-colon-here", ":", "zz:zz", "a".repeat(200) + ":short"]) {
    assert.equal(verifyPassword("anything", bad), false, `should reject ${JSON.stringify(bad)} without throwing`);
  }
});

test("verifyPassword rejects non-string inputs rather than throwing", () => {
  assert.equal(verifyPassword(null, "x:y"), false);
  assert.equal(verifyPassword("x", null), false);
  assert.equal(verifyPassword(undefined, undefined), false);
});

test("hashPassword refuses an empty password", () => {
  assert.throws(() => hashPassword(""));
});

test("getMasterKey requires CAREER_OPS_ENCRYPTION_KEY and validates its length", () => {
  assert.throws(() => getMasterKey({}), /CAREER_OPS_ENCRYPTION_KEY is not set/);
  assert.throws(() => getMasterKey({ CAREER_OPS_ENCRYPTION_KEY: "tooshort" }), /64 hex chars/);
  const good = "ab".repeat(32);
  const key = getMasterKey({ CAREER_OPS_ENCRYPTION_KEY: good });
  assert.equal(key.length, 32);
});

test("encryptSecret/decryptSecret round-trips the plaintext", () => {
  const key = getMasterKey({ CAREER_OPS_ENCRYPTION_KEY: "cd".repeat(32) });
  const enc = encryptSecret("sk-ant-super-secret-key-12345", key);
  assert.equal(typeof enc.iv, "string");
  assert.equal(typeof enc.ciphertext, "string");
  assert.equal(typeof enc.authTag, "string");
  assert.notEqual(enc.ciphertext, "sk-ant-super-secret-key-12345", "ciphertext must not equal the plaintext");
  assert.equal(decryptSecret(enc, key), "sk-ant-super-secret-key-12345");
});

test("decryptSecret rejects a tampered ciphertext (GCM auth tag fails)", () => {
  const key = getMasterKey({ CAREER_OPS_ENCRYPTION_KEY: "ef".repeat(32) });
  const enc = encryptSecret("sk-ant-super-secret-key-12345", key);
  const tampered = { ...enc, ciphertext: Buffer.from("tampered-bytes-here!").toString("base64") };
  assert.throws(() => decryptSecret(tampered, key));
});

test("decryptSecret rejects decryption under the wrong key", () => {
  const key1 = getMasterKey({ CAREER_OPS_ENCRYPTION_KEY: "11".repeat(32) });
  const key2 = getMasterKey({ CAREER_OPS_ENCRYPTION_KEY: "22".repeat(32) });
  const enc = encryptSecret("a secret", key1);
  assert.throws(() => decryptSecret(enc, key2));
});

test("encryptSecret refuses an empty plaintext", () => {
  const key = getMasterKey({ CAREER_OPS_ENCRYPTION_KEY: "33".repeat(32) });
  assert.throws(() => encryptSecret("", key));
});

test("maskSecret shows only the last 4 characters", () => {
  assert.equal(maskSecret("sk-ant-abcdef1234"), "****1234");
  assert.equal(maskSecret("ab"), "**");
  assert.equal(maskSecret(""), "");
});

test("randomToken produces distinct, correctly-sized hex tokens", () => {
  const a = randomToken();
  const b = randomToken();
  assert.notEqual(a, b);
  assert.equal(a.length, 64); // 32 bytes hex-encoded
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(randomToken(16).length, 32);
});
