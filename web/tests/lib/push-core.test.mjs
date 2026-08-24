// The rule this file guards (HANDOFF §7b): "Gate notifications carry no diff
// content in the payload." A push payload is rendered on a lock screen and
// passes through a third-party push service, so a company name or a CV diff in
// that path leaks the user's job search to a shoulder-surfer AND to the provider.
//
// Run:  node --test tests/lib/push-core.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { KIND_ROUTE, PUSH_KINDS, buildPayload, isGoneStatus, isValidSubscription, subscriptionId } from "../../src/lib/push/core.mjs";

test("a gate notification drops every caller-supplied detail", () => {
  const leaky = buildPayload({
    kind: "gate_opened",
    title: "Anthropic — Head of Applied AI",
    body: "4 edits to cv.md: replaced 'Led AI platform initiatives' with …",
    tag: "anthropic-247",
  });
  const serialized = JSON.stringify(leaky);
  for (const secret of ["Anthropic", "Head of Applied AI", "cv.md", "Led AI platform", "247"]) {
    assert.ok(!serialized.includes(secret), `"${secret}" must never reach a push payload`);
  }
  assert.equal(leaky.title, "An approval is waiting");
  assert.equal(leaky.tag, "gate_opened", "the tag must not carry an identifier either");
});

test("multiple gates leak only the count", () => {
  assert.equal(buildPayload({ kind: "gate_opened", count: 3 }).title, "3 approvals waiting");
  assert.equal(buildPayload({ kind: "gate_opened", count: 1 }).title, "An approval is waiting");
  // A nonsense count must not produce nonsense copy.
  assert.equal(buildPayload({ kind: "gate_opened", count: 0 }).title, "An approval is waiting");
  assert.equal(buildPayload({ kind: "gate_opened", count: -5 }).title, "An approval is waiting");
});

test("non-confidential kinds do carry their detail — the redaction is targeted", () => {
  const p = buildPayload({ kind: "worker_done", title: "Scan complete", body: "5 above your floor" });
  assert.equal(p.title, "Scan complete");
  assert.equal(p.body, "5 above your floor");
});

test("every kind maps to a route, and every route is app-relative", () => {
  for (const kind of PUSH_KINDS) {
    const route = KIND_ROUTE[kind];
    assert.ok(route, `${kind} has no route`);
    assert.ok(route.startsWith("/"), `${kind} route must be app-relative`);
    const p = buildPayload({ kind });
    assert.equal(p.url, route);
    assert.equal(p.actions[0].action, route, "the action must open the route");
  }
});

test("an off-site url is refused — a notification cannot navigate away from the app", () => {
  for (const bad of ["https://evil.example.com", "//evil.example.com", "javascript:alert(1)", "", null]) {
    const p = buildPayload({ kind: "worker_done", url: bad });
    assert.equal(p.url, KIND_ROUTE.worker_done, `url ${JSON.stringify(bad)} must fall back to the kind's route`);
  }
});

test("an unknown kind falls back rather than throwing", () => {
  const p = buildPayload({ kind: "not-a-kind" });
  assert.ok(PUSH_KINDS.includes(p.kind));
  assert.equal(buildPayload().kind, "worker_done");
});

test("newlines and length are clamped — the OS renders this text", () => {
  const p = buildPayload({ kind: "worker_done", title: "a\nb\tc", body: "x".repeat(500) });
  assert.equal(p.title, "a b c");
  assert.equal(p.body.length, 200);
});

test("a subscription must be https with both keys", () => {
  assert.equal(isValidSubscription({ endpoint: "https://fcm.googleapis.com/x", keys: { p256dh: "a", auth: "b" } }), true);
  for (const bad of [
    null,
    {},
    { endpoint: "http://insecure/x", keys: { p256dh: "a", auth: "b" } },
    { endpoint: "https://x/y" },
    { endpoint: "https://x/y", keys: {} },
    { endpoint: "https://x/y", keys: { p256dh: "a" } },
    { endpoint: "https://x/y", keys: { p256dh: "", auth: "b" } },
  ]) {
    assert.equal(isValidSubscription(bad), false, JSON.stringify(bad));
  }
});

test("the endpoint is the subscription's identity", () => {
  assert.equal(subscriptionId({ endpoint: "https://a/b", keys: { p256dh: "x", auth: "y" } }), "https://a/b");
  assert.equal(subscriptionId({}), null);
});

test("gone statuses prune, other failures retry", () => {
  for (const s of [404, 410, 403, 401]) assert.equal(isGoneStatus(s), true, String(s));
  for (const s of [429, 500, 502, 503, 201]) assert.equal(isGoneStatus(s), false, String(s));
});
