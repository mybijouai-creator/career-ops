// Tests for web/src/lib/auth/with-tenant.mjs — the policy that decides
// whether a request gets its own isolated root or falls through to the
// single-tenant shared one, and that career-ops.ts's careerOpsRoot() actually
// picks up the ambient tenant root once inside withTenant().
//
// Run:  node --test tests/lib/with-tenant.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, _resetForTest, createUser, setApiKey } from "../../src/lib/auth/db.mjs";
import { SESSION_COOKIE, loginCookie } from "../../src/lib/auth/session.mjs";
import { withTenant, withTenantHandler } from "../../src/lib/auth/with-tenant.mjs";
import { currentTenantRoot, currentApiKeyEnv } from "../../src/lib/auth/tenant-context.mjs";

function fakeRequest(cookieHeader) {
  return { headers: { get: (name) => (name.toLowerCase() === "cookie" ? cookieHeader ?? null : null) } };
}

function withTempPlatformRoot(fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-with-tenant-test-"));
  const prev = process.env.CAREER_OPS_ROOT;
  process.env.CAREER_OPS_ROOT = tmp;
  try {
    return fn(tmp);
  } finally {
    if (prev === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = prev;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test("an unauthenticated request runs with no ambient tenant root at all", () => {
  _resetForTest(openDatabase(":memory:"));
  assert.equal(currentTenantRoot(), undefined, "sanity: nothing set before the call");
  const seenInside = withTenant(fakeRequest(undefined), () => currentTenantRoot());
  assert.equal(seenInside, undefined);
  assert.equal(currentTenantRoot(), undefined, "still unset after the call returns");
});

test("an authenticated request runs with that user's own tenant root set", () => {
  return withTempPlatformRoot((tmp) => {
    _resetForTest(openDatabase(":memory:"));
    const user = createUser("tenant@example.com", "correcthorsebattery");
    const cookieValue = loginCookie(user.id).split(";")[0];
    const req = fakeRequest(cookieValue);

    const seenInside = withTenant(req, () => currentTenantRoot());
    assert.equal(seenInside, path.join(tmp, "tenants", user.id));
    assert.equal(currentTenantRoot(), undefined, "the ambient root does not leak past the call");
  });
});

test("two different signed-in users see two different roots, even across concurrent calls", async () => {
  return withTempPlatformRoot(async () => {
    _resetForTest(openDatabase(":memory:"));
    const alice = createUser("alice@example.com", "correcthorsebattery");
    const bob = createUser("bob@example.com", "correcthorsebattery");
    const aliceReq = fakeRequest(loginCookie(alice.id).split(";")[0]);
    const bobReq = fakeRequest(loginCookie(bob.id).split(";")[0]);

    // Run "concurrently" (interleaved via async gaps) to prove AsyncLocalStorage
    // keeps each call's root scoped to its own async context, not a shared
    // module-level variable that the second call would stomp on.
    const [aliceRoot, bobRoot] = await Promise.all([
      withTenant(aliceReq, async () => {
        await new Promise((r) => setTimeout(r, 5));
        return currentTenantRoot();
      }),
      withTenant(bobReq, async () => {
        return currentTenantRoot();
      }),
    ]);
    assert.notEqual(aliceRoot, bobRoot);
    assert.match(aliceRoot, new RegExp(alice.id));
    assert.match(bobRoot, new RegExp(bob.id));
  });
});

test("withTenant's session cookie name matches the one session.mjs reads on real requests", () => {
  // Cheap guard against the two modules' cookie name drifting apart silently.
  assert.equal(SESSION_COOKIE, "career-ops-session");
});

test("withTenantHandler applies the tenant root even when the inner handler declares zero parameters", () => {
  return withTempPlatformRoot((tmp) => {
    _resetForTest(openDatabase(":memory:"));
    const user = createUser("bare-get@example.com", "correcthorsebattery");
    const req = fakeRequest(loginCookie(user.id).split(";")[0]);
    // Mirrors a real route like `export async function GET() { ... }` — Next
    // still calls it with (req), the handler just doesn't name the parameter.
    const bareGetHandler = () => currentTenantRoot();
    const wrapped = withTenantHandler(bareGetHandler);
    const seen = wrapped(req);
    assert.equal(seen, path.join(tmp, "tenants", user.id));
  });
});

test("withTenant resolves the user's own stored API key into the ambient context, for spawnEnv() to pick up downstream", () => {
  const prevKey = process.env.CAREER_OPS_ENCRYPTION_KEY;
  process.env.CAREER_OPS_ENCRYPTION_KEY = "ab".repeat(32);
  try {
    return withTempPlatformRoot(() => {
      _resetForTest(openDatabase(":memory:"));
      const user = createUser("withkey@example.com", "correcthorsebattery");
      setApiKey(user.id, "openai", "sk-real-openai-key", Buffer.from("ab".repeat(32), "hex"));
      const req = fakeRequest(loginCookie(user.id).split(";")[0]);

      const seen = withTenant(req, () => currentApiKeyEnv());
      assert.deepEqual(seen, { OPENAI_API_KEY: "sk-real-openai-key" });
      assert.deepEqual(currentApiKeyEnv(), {}, "does not leak past the call — back to the empty default");
    });
  } finally {
    if (prevKey === undefined) delete process.env.CAREER_OPS_ENCRYPTION_KEY;
    else process.env.CAREER_OPS_ENCRYPTION_KEY = prevKey;
  }
});

test("withTenant degrades to an empty apiKeyEnv when the deployment has no CAREER_OPS_ENCRYPTION_KEY configured", () => {
  const prevKey = process.env.CAREER_OPS_ENCRYPTION_KEY;
  delete process.env.CAREER_OPS_ENCRYPTION_KEY;
  try {
    return withTempPlatformRoot(() => {
      _resetForTest(openDatabase(":memory:"));
      const user = createUser("nokeyconfig@example.com", "correcthorsebattery");
      const req = fakeRequest(loginCookie(user.id).split(";")[0]);
      const seen = withTenant(req, () => currentApiKeyEnv());
      assert.deepEqual(seen, {});
    });
  } finally {
    if (prevKey === undefined) delete process.env.CAREER_OPS_ENCRYPTION_KEY;
    else process.env.CAREER_OPS_ENCRYPTION_KEY = prevKey;
  }
});

test("withTenantHandler forwards extra arguments (e.g. a dynamic route's params) unchanged", async () => {
  _resetForTest(openDatabase(":memory:"));
  const dynamicHandler = (req, ctx) => ctx;
  const wrapped = withTenantHandler(dynamicHandler);
  const fakeCtx = { params: Promise.resolve({ roleId: "42" }) };
  const result = wrapped(fakeRequest(undefined), fakeCtx);
  assert.equal(result, fakeCtx);
  assert.deepEqual(await result.params, { roleId: "42" });
});
