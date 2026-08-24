// The offline queue's one non-negotiable rule (HANDOFF §7b): a GATED action
// never queues-and-replays. An approval captured offline is an intent, and the
// human is asked again against live state — a stale diff must not be able to
// write files. These tests assert that from the outside, so a new action added
// to the table cannot quietly become replayable.
//
// Run:  node --test tests/lib/pwa-queue-core.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIONS,
  dispositionOf,
  idempotencyKey,
  isReplayable,
  labelOf,
  needsReconfirm,
  replayRequest,
} from "../../public/pwa/queue-core.mjs";

test("approvals and irreversible writes are intents, never replayable", () => {
  for (const action of ["gate-approve", "tracker-delete", "profile-save", "portals-save", "cv-save"]) {
    assert.equal(needsReconfirm(action), true, `${action} must need re-confirmation`);
    assert.equal(isReplayable(action), false, `${action} must NOT be replayable`);
    assert.equal(replayRequest({ action, key: "k", payload: {} }), null, `${action} must refuse to build a replay request`);
  }
});

test("only the three simple mutations replay unattended", () => {
  const replayable = Object.keys(ACTIONS).filter(isReplayable).sort();
  assert.deepEqual(replayable, ["followup-log", "followup-override", "status-advance"]);
});

test("token-spending actions cannot be queued at all", () => {
  for (const action of ["artifact-cv", "artifact-cover", "evaluate"]) {
    assert.equal(dispositionOf(action), "online", action);
    assert.equal(isReplayable(action), false);
    assert.equal(needsReconfirm(action), false);
  }
});

test("an unknown action defaults to online — never to replayable", () => {
  // Fail-safe: a typo'd or future action must not inherit replay rights.
  assert.equal(dispositionOf("not-a-real-action"), "online");
  assert.equal(isReplayable("not-a-real-action"), false);
  assert.equal(replayRequest({ action: "not-a-real-action", key: "k" }), null);
});

test("every replayable action declares the endpoint its replay posts to", () => {
  for (const action of Object.keys(ACTIONS).filter(isReplayable)) {
    assert.ok(ACTIONS[action].endpoint, `${action} is replayable but has no endpoint`);
    const req = replayRequest({ action, key: "k1", payload: { n: "1" } });
    assert.equal(req.url, ACTIONS[action].endpoint);
    assert.equal(req.init.method, "POST");
    assert.equal(req.init.headers["X-Idempotency-Key"], "k1");
  }
});

test("the idempotency key is deterministic and key-order independent", () => {
  const a = idempotencyKey("status-advance", "12", { n: "12", status: "Interview" });
  const b = idempotencyKey("status-advance", "12", { status: "Interview", n: "12" });
  assert.equal(a, b, "the same logical write must collapse to one queue entry");
  assert.equal(a, idempotencyKey("status-advance", "12", { n: "12", status: "Interview" }));
});

test("keys separate writes that differ in any part", () => {
  const base = idempotencyKey("status-advance", "12", { n: "12", status: "Interview" });
  const byStatus = idempotencyKey("status-advance", "12", { n: "12", status: "Offer" });
  const byTarget = idempotencyKey("status-advance", "13", { n: "13", status: "Interview" });
  const byAction = idempotencyKey("followup-log", "12", { n: "12", status: "Interview" });
  const keys = new Set([base, byStatus, byTarget, byAction]);
  assert.equal(keys.size, 4, "distinct writes must not share a key");
});

test("keys stay distinct across a run of near-identical payloads", () => {
  // The realistic collision risk: 200 rows differing only in a trailing number.
  const keys = new Set();
  for (let i = 0; i < 200; i++) keys.add(idempotencyKey("status-advance", String(i), { n: String(i), status: "Applied" }));
  assert.equal(keys.size, 200);
});

test("the key is prefixed with its action, so a queue row is legible on sight", () => {
  assert.match(idempotencyKey("status-advance", "1", {}), /^status-advance-/);
});

test("nested and array payloads hash stably", () => {
  const x = idempotencyKey("followup-log", "3", { tags: ["a", "b"], meta: { z: 1, a: 2 } });
  const y = idempotencyKey("followup-log", "3", { meta: { a: 2, z: 1 }, tags: ["a", "b"] });
  assert.equal(x, y);
  // Array ORDER is meaningful and must change the key.
  assert.notEqual(x, idempotencyKey("followup-log", "3", { tags: ["b", "a"], meta: { z: 1, a: 2 } }));
});

test("undefined and null payload fields are treated the same", () => {
  // JSON.stringify drops undefined keys, so canonicalize must normalise them or
  // the same write hashes differently depending on how the caller built it.
  assert.equal(
    idempotencyKey("status-advance", "1", { n: "1", note: undefined }),
    idempotencyKey("status-advance", "1", { n: "1", note: null }),
  );
});

test("every action has a human label", () => {
  for (const action of Object.keys(ACTIONS)) {
    assert.ok(labelOf(action).length > 0, action);
    assert.notEqual(labelOf(action), action, `${action} should have a prose label, not its own id`);
  }
});
