// Tests for web/src/lib/auth/tenant-provision.mjs. Runs outside the real
// Docker image (no /opt/career-ops here, on any CI runner), so every case
// below exercises the mkdir-only fallback path — the real docker-seed-root.sh
// invocation is verified separately, against an actual container build, not
// by a unit test that would need to fake being inside one.
//
// Run:  node --test tests/lib/tenant-provision.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tenantRootPath, ensureTenantRoot } from "../../src/lib/auth/tenant-provision.mjs";

const VALID_ID = "abebc0a7c771aaff69b08f14a145fd62"; // 32 hex chars, matches randomToken(16)

test("tenantRootPath builds {platformRoot}/tenants/{id} for a well-formed id", () => {
  const p = tenantRootPath(VALID_ID);
  assert.ok(p.endsWith(path.join("tenants", VALID_ID)));
});

test("tenantRootPath rejects anything that isn't exactly 32 hex characters", () => {
  for (const bad of ["", "not-hex-at-all", "abebc0a7c771aaff69b08f14a145fd6", "abebc0a7c771aaff69b08f14a145fd622", "../../etc/passwd", "ABEBC0A7C771AAFF69B08F14A145FD62"]) {
    assert.throws(() => tenantRootPath(bad), `should reject ${JSON.stringify(bad)}`);
  }
});

test("tenantRootPath rejects null/undefined rather than building a path from them", () => {
  assert.throws(() => tenantRootPath(null));
  assert.throws(() => tenantRootPath(undefined));
});

test("ensureTenantRoot creates the directory and returns its path (mkdir-only fallback, no Docker image present)", () => {
  const tmpPlatformRoot = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-tenant-test-"));
  const prev = process.env.CAREER_OPS_ROOT;
  process.env.CAREER_OPS_ROOT = tmpPlatformRoot;
  try {
    const root = ensureTenantRoot(VALID_ID);
    assert.equal(root, path.join(tmpPlatformRoot, "tenants", VALID_ID));
    assert.equal(fs.statSync(root).isDirectory(), true);
  } finally {
    if (prev === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = prev;
    fs.rmSync(tmpPlatformRoot, { recursive: true, force: true });
  }
});

test("ensureTenantRoot is idempotent — calling it twice for the same user doesn't throw or duplicate", () => {
  const tmpPlatformRoot = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-tenant-test-"));
  const prev = process.env.CAREER_OPS_ROOT;
  process.env.CAREER_OPS_ROOT = tmpPlatformRoot;
  try {
    const first = ensureTenantRoot(VALID_ID);
    fs.writeFileSync(path.join(first, "marker.txt"), "still here");
    const second = ensureTenantRoot(VALID_ID);
    assert.equal(second, first);
    assert.equal(fs.readFileSync(path.join(second, "marker.txt"), "utf8"), "still here", "a second call must not wipe an existing tenant directory");
  } finally {
    if (prev === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = prev;
    fs.rmSync(tmpPlatformRoot, { recursive: true, force: true });
  }
});

test("two different users resolve to two different, non-overlapping directories", () => {
  const tmpPlatformRoot = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-tenant-test-"));
  const prev = process.env.CAREER_OPS_ROOT;
  process.env.CAREER_OPS_ROOT = tmpPlatformRoot;
  try {
    const idB = "1".repeat(32);
    const rootA = ensureTenantRoot(VALID_ID);
    const rootB = ensureTenantRoot(idB);
    assert.notEqual(rootA, rootB);
    fs.writeFileSync(path.join(rootA, "only-a.txt"), "a");
    assert.equal(fs.existsSync(path.join(rootB, "only-a.txt")), false, "writing into A's root must not appear under B's");
  } finally {
    if (prev === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = prev;
    fs.rmSync(tmpPlatformRoot, { recursive: true, force: true });
  }
});
