// Tests for web/src/lib/auth/spawn-env.mjs — the environment handed to a
// spawned CLI child process, which (unlike careerOpsRoot()) cannot see the
// parent's AsyncLocalStorage on its own; spawnEnv() reads the SAME ambient
// context career-ops.ts's careerOpsRoot() does and folds it into a plain env
// object a spawn call can use directly.
//
// Run:  node --test tests/lib/spawn-env.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { runWithTenantContext } from "../../src/lib/auth/tenant-context.mjs";
import { spawnEnv } from "../../src/lib/auth/spawn-env.mjs";

test("outside any tenant context, spawnEnv returns plain process.env plus CAREER_OPS_ROOT from the default resolution", () => {
  const env = spawnEnv();
  assert.equal(env.PATH, process.env.PATH, "still inherits the rest of the real environment");
  assert.equal(typeof env.CAREER_OPS_ROOT, "string", "careerOpsRoot() always resolves to something, even with nothing configured");
});

test("inside a tenant context, spawnEnv reports that context's root, not the default one", () => {
  const seen = runWithTenantContext("/tenants/abc123", {}, () => spawnEnv());
  assert.equal(seen.CAREER_OPS_ROOT, "/tenants/abc123");
});

test("inside a tenant context with a resolved API key, spawnEnv includes it", () => {
  const seen = runWithTenantContext("/tenants/abc123", { ANTHROPIC_API_KEY: "sk-ant-real-value" }, () => spawnEnv());
  assert.equal(seen.CAREER_OPS_ROOT, "/tenants/abc123");
  assert.equal(seen.ANTHROPIC_API_KEY, "sk-ant-real-value");
});

test("a tenant context with no stored key (empty apiKeyEnv) adds nothing beyond the root", () => {
  const seen = runWithTenantContext("/tenants/nokey", {}, () => spawnEnv());
  assert.equal(seen.CAREER_OPS_ROOT, "/tenants/nokey");
  assert.equal(seen.ANTHROPIC_API_KEY, process.env.ANTHROPIC_API_KEY, "untouched, not blanked out");
});

test("the ambient context does not leak between two sequential calls", () => {
  const first = runWithTenantContext("/tenants/one", { ANTHROPIC_API_KEY: "key-one" }, () => spawnEnv());
  const second = spawnEnv();
  assert.equal(first.CAREER_OPS_ROOT, "/tenants/one");
  assert.notEqual(second.CAREER_OPS_ROOT, "/tenants/one");
  assert.equal(second.ANTHROPIC_API_KEY, process.env.ANTHROPIC_API_KEY);
});
