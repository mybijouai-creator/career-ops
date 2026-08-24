// The gate protocol is the human-in-the-loop guarantee (HANDOFF §1 invariant 2:
// "There is no toggle to disable this"). These assert the three ways past a gate
// that must NOT exist: without a token, after expiry, and twice.
//
// Run:  node --test tests/lib/gates-core.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DECISIONS,
  GATE_TTL_MS,
  canDecide,
  gateEvent,
  isExpired,
  ledgerHeader,
  parseRow,
  serializeRow,
} from "../../src/lib/gates/core.mjs";

const gate = (over = {}) => ({ id: "g_1", runId: "r_1", kind: "cv_diff", createdAt: Date.now(), token: "tok", decision: "pending", willWrite: ["a"], estCostUsd: 0.06, ...over });

test("a gate cannot be decided without the token it was opened with", () => {
  for (const bad of ["", null, undefined, "wrong", "TOK"]) {
    const r = canDecide(gate(), bad);
    assert.equal(r.ok, false, `token ${JSON.stringify(bad)} must be refused`);
    assert.equal(r.status, 403);
  }
  assert.equal(canDecide(gate(), "tok").ok, true);
});

test("a gate expires after exactly 24h and cannot then be approved", () => {
  const now = Date.now();
  assert.equal(isExpired({ createdAt: now }, now), false);
  assert.equal(isExpired({ createdAt: now - GATE_TTL_MS }, now), false, "exactly 24h is still live");
  assert.equal(isExpired({ createdAt: now - GATE_TTL_MS - 1 }, now), true);
  const r = canDecide(gate({ createdAt: now - GATE_TTL_MS - 1 }), "tok", now);
  assert.equal(r.ok, false);
  assert.equal(r.status, 410);
});

test("a gate cannot be decided twice", () => {
  for (const decision of ["approved", "rejected", "expired"]) {
    const r = canDecide(gate({ decision }), "tok");
    assert.equal(r.ok, false, `${decision} must not be re-decidable`);
    assert.equal(r.status, 409);
  }
});

test("a missing gate is a 404, not a silent allow", () => {
  const r = canDecide(null, "tok");
  assert.equal(r.ok, false);
  assert.equal(r.status, 404);
});

test("a malformed createdAt is treated as expired, never as live", () => {
  // Fail closed: an unparseable gate must not be approvable.
  for (const bad of [undefined, null, "yesterday", NaN]) {
    assert.equal(isExpired({ createdAt: bad }), true, String(bad));
  }
});

test("the ledger round-trips, including the willWrite list", () => {
  const row = serializeRow({
    gateId: "g_1", at: 0, runId: "r_1", kind: "cv_diff", decision: "approved",
    estCostUsd: 0.06, willWrite: ["output/1-cv.pdf", "data/applications.md"], note: "Anthropic",
  });
  const parsed = parseRow(row);
  assert.equal(parsed.gateId, "g_1");
  assert.equal(parsed.decision, "approved");
  assert.equal(parsed.actor, "local");
  assert.deepEqual(parsed.willWrite, ["output/1-cv.pdf", "data/applications.md"]);
  assert.equal(parsed.note, "Anthropic");
  assert.equal(parsed.estCostUsd, 0.06);
});

test("tabs and newlines in a note cannot break the row", () => {
  const row = serializeRow({
    gateId: "g_1", at: 0, runId: "r_1", kind: "cv_diff", decision: "rejected",
    willWrite: [], note: "line one\nline\ttwo",
  });
  assert.equal(row.split("\n").length, 1, "a note must never introduce a second row");
  assert.equal(row.split("\t").length, 9, "a note must never introduce a column");
  assert.match(parseRow(row).note, /line one line two/);
});

test("an absent value is the sentinel, never an empty cell", () => {
  const row = serializeRow({ gateId: "g_1", at: 0, runId: "r_1", kind: "cv_diff", decision: "pending" });
  assert.ok(!row.includes("\t\t"), "an empty cell is ambiguous in a TSV");
  assert.equal(parseRow(row).note, null);
  assert.deepEqual(parseRow(row).willWrite, []);
});

test("an unknown decision is refused at serialization", () => {
  assert.throws(() => serializeRow({ gateId: "g", decision: "maybe" }), /unknown gate decision/);
  assert.deepEqual(DECISIONS, ["pending", "approved", "rejected", "expired"]);
});

test("the header names every column, and a comment row is not parsed as data", () => {
  const header = ledgerHeader();
  assert.match(header, /^#/);
  assert.equal(parseRow(header), null);
  assert.equal(header.split("\t").length, 9);
});

test("blank and short rows parse to null rather than a half-gate", () => {
  for (const bad of ["", "   ", "\t\t", "only\tfour\tcolumns\there", null, 42]) {
    assert.equal(parseRow(bad), null, JSON.stringify(bad));
  }
});

test("the gate event carries the diff, the file list, the cost and the token", () => {
  const e = gateEvent(gate());
  assert.equal(e.type, "gate");
  assert.equal(e.gateId, "g_1");
  assert.deepEqual(e.willWrite, ["a"]);
  assert.equal(e.estCostUsd, 0.06);
  // The token rides the stream because the client has to send it back — this is
  // the only channel it ever travels on.
  assert.equal(e.token, "tok");
  assert.equal(e.expiresAt, gate().createdAt + GATE_TTL_MS);
});
