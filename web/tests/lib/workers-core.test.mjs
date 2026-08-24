// Two §1 invariants are enforced in workers/core.mjs, and both are the kind that
// decay silently: scanning must cost nothing, and a daily ceiling must actually
// REFUSE rather than merely report. A ceiling that is only displayed is not a
// ceiling.
//
// Run:  node --test tests/lib/workers-core.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_DAILY_CAP_USD,
  WORKERS,
  canSpend,
  capFromEnv,
  dueWorkers,
  isDue,
  spendDayKey,
  workerById,
} from "../../src/lib/workers/core.mjs";

const NOW = Date.UTC(2026, 7, 24, 12, 0, 0);

test("scanning and liveness are free — only evaluation spends", () => {
  assert.equal(workerById("scan").costsTokens, false);
  assert.equal(workerById("liveness").costsTokens, false);
  assert.equal(workerById("batch-eval").costsTokens, true);
  // Exactly one spending worker: if a second appears, the ceiling logic and this
  // assertion both need revisiting deliberately.
  assert.equal(WORKERS.filter((w) => w.costsTokens).length, 1);
});

test("a worker that has never run is due immediately", () => {
  // A fresh install must not wait 12h for its first scan.
  assert.equal(isDue(workerById("scan"), {}, NOW), true);
  assert.equal(isDue(workerById("scan"), { lastRunAt: undefined }, NOW), true);
  assert.equal(isDue(workerById("scan"), { lastRunAt: NaN }, NOW), true);
});

test("a running worker is never due, so a slow scan cannot start twice", () => {
  assert.equal(isDue(workerById("scan"), { running: true }, NOW), false);
  assert.equal(isDue(workerById("scan"), { running: true, lastRunAt: 0 }, NOW), false);
});

test("a disabled worker is never due", () => {
  assert.equal(isDue(workerById("scan"), { enabled: false }, NOW), false);
});

test("the interval boundary is inclusive", () => {
  const w = workerById("scan");
  assert.equal(isDue(w, { lastRunAt: NOW - w.everyMs }, NOW), true, "exactly one interval later is due");
  assert.equal(isDue(w, { lastRunAt: NOW - w.everyMs + 1 }, NOW), false);
});

test("the daily ceiling refuses a spending worker and never a free one", () => {
  const day = spendDayKey(NOW);
  const over = { day, usd: 3 };
  assert.equal(canSpend(workerById("batch-eval"), over, 2.25, NOW).ok, false);
  // Refusing a zero-cost scan because an evaluation was expensive would only
  // make the pipeline worse.
  assert.equal(canSpend(workerById("scan"), over, 2.25, NOW).ok, true);
  assert.equal(canSpend(workerById("liveness"), over, 2.25, NOW).ok, true);
});

test("the ceiling is reached AT the cap, not past it", () => {
  const day = spendDayKey(NOW);
  assert.equal(canSpend(workerById("batch-eval"), { day, usd: 2.24 }, 2.25, NOW).ok, true);
  assert.equal(canSpend(workerById("batch-eval"), { day, usd: 2.25 }, 2.25, NOW).ok, false);
});

test("yesterday's spend does not count against today's ceiling", () => {
  const yesterday = spendDayKey(NOW - 24 * 3600 * 1000);
  assert.notEqual(yesterday, spendDayKey(NOW));
  assert.equal(canSpend(workerById("batch-eval"), { day: yesterday, usd: 999 }, 2.25, NOW).ok, true);
});

test("a cap of 0 is a valid 'never spend', not a missing value", () => {
  const day = spendDayKey(NOW);
  assert.equal(canSpend(workerById("batch-eval"), { day, usd: 0 }, 0, NOW).ok, false);
  assert.equal(capFromEnv({ CAREER_OPS_DAILY_USD_CAP: "0" }), 0);
});

test("a malformed cap falls back to the default rather than to unlimited", () => {
  for (const bad of ["", "abc", "-1", undefined, null]) {
    assert.equal(
      capFromEnv({ CAREER_OPS_DAILY_USD_CAP: bad }),
      DEFAULT_DAILY_CAP_USD,
      `cap ${JSON.stringify(bad)} must fall back, not become unlimited`,
    );
  }
  assert.equal(capFromEnv({ CAREER_OPS_DAILY_USD_CAP: "5.5" }), 5.5);
  assert.equal(capFromEnv({}), DEFAULT_DAILY_CAP_USD);
});

test("the day key is local, so a daily cap does not roll over mid-afternoon", () => {
  const key = spendDayKey(NOW);
  assert.match(key, /^\d{4}-\d{2}-\d{2}$/);
  const d = new Date(NOW);
  assert.equal(key, `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}-${`${d.getDate()}`.padStart(2, "0")}`);
});

test("free workers are selected before the spending one", () => {
  // After a scan there may be roles worth evaluating; evaluating first is always
  // one tick behind the discovery that justified it.
  const due = dueWorkers({}, { day: spendDayKey(NOW), usd: 0 }, 2.25, NOW).map((w) => w.id);
  assert.deepEqual(due, ["scan", "liveness", "batch-eval"]);
  assert.ok(due.indexOf("scan") < due.indexOf("batch-eval"));
});

test("the ceiling removes the spending worker from a tick's selection", () => {
  const due = dueWorkers({}, { day: spendDayKey(NOW), usd: 99 }, 2.25, NOW).map((w) => w.id);
  assert.deepEqual(due, ["scan", "liveness"]);
});

test("an unknown worker id resolves to null and is never due", () => {
  assert.equal(workerById("nope"), null);
  assert.equal(isDue(null, {}, NOW), false);
});
