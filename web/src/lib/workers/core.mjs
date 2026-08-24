/**
 * core.mjs — worker definitions, when they are due, and the spend ceiling.
 *
 * HANDOFF.md step 4: "scheduled scan, batch eval, liveness recheck; results push
 * into the decision queue. Notifications."
 *
 * Two invariants from §1 are enforced here rather than in the runner, so they
 * can be tested without a filesystem or a CLI:
 *
 *   4. Scanning and filtering cost zero tokens. Only evaluation, drafting and
 *      prep spend. → every worker declares `costsTokens`, and the free ones are
 *      asserted to be free.
 *   3. Every run is priced […] and enforces per-mode + per-day ceilings. → a
 *      spending worker is refused once the day's ceiling is reached. A ceiling
 *      that is merely reported is not a ceiling.
 */

/** Default daily ceiling in USD. Overridden by CAREER_OPS_DAILY_USD_CAP. */
export const DEFAULT_DAILY_CAP_USD = 2.25;

/**
 * The workers, in the order a tick considers them.
 *
 * Free workers run first on purpose: after a scan there may be new roles worth
 * evaluating, and the same tick can then act on them. Running the eval first
 * would always be one tick behind the discovery that justified it.
 */
export const WORKERS = [
  {
    id: "scan",
    label: "Scan portals",
    // Zero tokens by construction: HTTP and JSON against public ATS boards, no
    // model in the path at all.
    costsTokens: false,
    everyMs: 12 * 60 * 60 * 1000,
    describe: "Sweeps your configured boards for new postings. Free.",
  },
  {
    id: "liveness",
    label: "Recheck liveness",
    costsTokens: false,
    everyMs: 24 * 60 * 60 * 1000,
    describe: "Re-verifies that tracked postings are still open. Free.",
  },
  {
    id: "batch-eval",
    label: "Evaluate the backlog",
    // The only spending worker, and therefore the only one the ceiling can stop.
    costsTokens: true,
    everyMs: 24 * 60 * 60 * 1000,
    describe: "Scores discovered roles that clear your floor. Spends tokens.",
  },
];

export function workerById(id) {
  return WORKERS.find((w) => w.id === id) ?? null;
}

/**
 * Is this worker due?
 *
 * A worker that has NEVER run is due immediately — a fresh install should not
 * wait twelve hours for its first scan. A worker currently running is never due,
 * so a slow scan cannot be started a second time on the next tick.
 */
export function isDue(worker, state, now = Date.now()) {
  if (!worker) return false;
  const s = state ?? {};
  if (s.running) return false;
  if (s.enabled === false) return false;
  if (!Number.isFinite(s.lastRunAt)) return true;
  return now - s.lastRunAt >= worker.everyMs;
}

/** Today, in the local calendar, as the key the daily spend is bucketed under. */
export function spendDayKey(now = Date.now()) {
  const d = new Date(now);
  // Local rather than UTC: a "daily cap" that rolls over mid-afternoon for the
  // user is not the cap they think they set.
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * May this worker spend right now?
 *
 * Free workers are always allowed — the ceiling exists to bound cost, and
 * refusing a zero-cost scan because an evaluation was expensive would only make
 * the pipeline worse.
 *
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function canSpend(worker, spend, capUsd = DEFAULT_DAILY_CAP_USD, now = Date.now()) {
  if (!worker?.costsTokens) return { ok: true };
  const cap = Number.isFinite(capUsd) && capUsd >= 0 ? capUsd : DEFAULT_DAILY_CAP_USD;
  const key = spendDayKey(now);
  const spentToday = spend && spend.day === key ? Number(spend.usd) || 0 : 0;
  if (spentToday >= cap) {
    return { ok: false, reason: `the $${cap.toFixed(2)}/day ceiling is reached ($${spentToday.toFixed(2)} spent) — resets tomorrow` };
  }
  return { ok: true };
}

/** Parse the cap from the environment, falling back to the default. */
export function capFromEnv(env = {}) {
  const raw = env.CAREER_OPS_DAILY_USD_CAP;
  if (raw === undefined || raw === null || raw === "") return DEFAULT_DAILY_CAP_USD;
  const n = Number(raw);
  // A negative or unparseable cap is a configuration mistake. Falling back to
  // the default is safer than treating it as "unlimited"; `0` remains a valid,
  // explicit "never spend".
  if (!Number.isFinite(n) || n < 0) return DEFAULT_DAILY_CAP_USD;
  return n;
}

/** Which workers a tick should start, given all their states. */
export function dueWorkers(states, spend, capUsd, now = Date.now()) {
  const out = [];
  for (const w of WORKERS) {
    if (!isDue(w, states?.[w.id], now)) continue;
    if (!canSpend(w, spend, capUsd, now).ok) continue;
    out.push(w);
  }
  return out;
}
