import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { spendDayKey } from "@/lib/workers/core.mjs";

/**
 * state.ts — when each worker last ran, and what has been spent today.
 *
 * Persisted, because the alternative is a restart re-running every worker
 * immediately: a Next process that reloads on deploy would scan, recheck
 * liveness and start evaluating the backlog on boot, which is both surprising
 * and — for the evaluating one — expensive.
 */

export type WorkerState = {
  lastRunAt?: number;
  lastOk?: boolean;
  lastNote?: string;
  lastMs?: number;
  running?: boolean;
  enabled?: boolean;
};

export type Spend = { day: string; usd: number };

type Persisted = { workers: Record<string, WorkerState>; spend: Spend };

function statePath(): string {
  return path.join(careerOpsRoot(), "data", "worker-state.json");
}

function empty(): Persisted {
  return { workers: {}, spend: { day: spendDayKey(), usd: 0 } };
}

export function readState(): Persisted {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath(), "utf8")) as Partial<Persisted>;
    const spend = parsed.spend && typeof parsed.spend.day === "string" ? parsed.spend : empty().spend;
    return {
      workers: parsed.workers && typeof parsed.workers === "object" ? parsed.workers : {},
      // Roll the bucket over on read: a state file written yesterday must not
      // carry yesterday's spend into today's ceiling.
      spend: spend.day === spendDayKey() ? { day: spend.day, usd: Number(spend.usd) || 0 } : { day: spendDayKey(), usd: 0 },
    };
  } catch {
    return empty();
  }
}

function writeState(state: Persisted): void {
  try {
    const file = statePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Temp-then-rename, so a crash mid-write cannot leave a truncated file that
    // reads as "no worker has ever run" and triggers everything at once.
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
    fs.renameSync(tmp, file);
  } catch {
    // Losing the timestamps costs a duplicate run, not correctness.
  }
}

export function patchWorker(id: string, patch: WorkerState): void {
  const state = readState();
  state.workers[id] = { ...state.workers[id], ...patch };
  writeState(state);
}

export function getWorker(id: string): WorkerState {
  return readState().workers[id] ?? {};
}

/** Record real spend against today's bucket. */
export function addSpend(usd: number): void {
  if (!Number.isFinite(usd) || usd <= 0) return;
  const state = readState();
  state.spend = { day: spendDayKey(), usd: (state.spend.usd || 0) + usd };
  writeState(state);
}

export function getSpend(): Spend {
  return readState().spend;
}

/**
 * Clear a `running` flag left behind by a process that died mid-run.
 *
 * Without this a crash during a scan marks it permanently running and the worker
 * never fires again — the failure mode is silence, which is the hardest kind to
 * notice. Called once at scheduler start, when by definition nothing is running.
 */
export function clearStaleRunning(): void {
  const state = readState();
  let changed = false;
  for (const [id, w] of Object.entries(state.workers)) {
    if (w.running) {
      state.workers[id] = { ...w, running: false, lastNote: "interrupted by a restart" };
      changed = true;
    }
  }
  if (changed) writeState(state);
}
