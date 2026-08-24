import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { careerOpsRoot } from "@/lib/career-ops";
import { encodeEvent, isTerminal, validateEvent } from "@/lib/runs/events.mjs";

/**
 * store.ts — the run registry behind /api/agent/intent and /api/runs/:id/stream.
 *
 * Two jobs, deliberately separated:
 *
 *   LIVE   an in-memory buffer plus subscriber set, so a stream that attaches
 *          mid-run replays what it missed and then follows along. Attaching late
 *          is the normal case, not the exception: the client gets a runId from
 *          the intent call and opens the stream on the next tick.
 *   LEDGER an append-only `runs/{id}.jsonl` beside the user's other files, which
 *          is what makes a run auditable after the process restarts. HANDOFF §6
 *          maps `Run` to exactly this.
 *
 * Single local Node process, same as run-registry.ts — a module-level Map is
 * enough, and the ledger is what survives a restart. It is NOT a queue: nothing
 * here resumes a run whose process died. A run interrupted by a restart is
 * reported as interrupted rather than silently retried, because retrying a
 * half-applied mode chain could double-write the tracker.
 */

export type RunEvent = Record<string, unknown> & { type: string; at?: number };

export type PlanStep = { mode: string; label: string; estCostUsd: number; gated: boolean };

export type Run = {
  id: string;
  startedAt: number;
  /** The plan as returned by the router, before execution. */
  plan: PlanStep[];
  chain: string[];
  estCostUsd: number;
  /** What the user typed / dropped, kept for the ledger. */
  input: string;
  state: "planned" | "running" | "suspended" | "done" | "failed";
  /** Set while the run is parked on a gate (HANDOFF §5 step 1). */
  gateId?: string;
  events: RunEvent[];
  /** Real accounting, filled in as the run reports usage. Never estimated. */
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  files: string[];
  ms?: number;
};

type Subscriber = (event: RunEvent) => void;

const runs = new Map<string, Run>();
const subscribers = new Map<string, Set<Subscriber>>();

/** Cap the in-memory history. The ledger on disk is the complete record. */
const MAX_RUNS_IN_MEMORY = 50;

function runsDir(): string {
  return path.join(careerOpsRoot(), "runs");
}

function ledgerPath(id: string): string {
  return path.join(runsDir(), `${id}.jsonl`);
}

/** `r_` + a uuid, matching the `r_01J…` shape in the handoff's example. */
function newRunId(): string {
  return `r_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

export function createRun(args: { input: string; plan: PlanStep[]; chain: string[]; estCostUsd: number }): Run {
  const run: Run = {
    id: newRunId(),
    startedAt: Date.now(),
    plan: args.plan,
    chain: args.chain,
    estCostUsd: args.estCostUsd,
    input: args.input,
    state: "planned",
    events: [],
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    files: [],
  };
  runs.set(run.id, run);

  // Evict the oldest finished runs. A run still streaming or parked on a gate is
  // never evicted, however old — a gate that vanished from memory could not be
  // approved, and the user would be left with a diff and no button.
  if (runs.size > MAX_RUNS_IN_MEMORY) {
    const evictable = [...runs.values()]
      .filter((r) => r.state === "done" || r.state === "failed")
      .sort((a, b) => a.startedAt - b.startedAt);
    for (const r of evictable.slice(0, runs.size - MAX_RUNS_IN_MEMORY)) {
      runs.delete(r.id);
      subscribers.delete(r.id);
    }
  }

  appendLedger(run.id, { type: "plan", steps: args.plan, estCostUsd: args.estCostUsd, at: run.startedAt });
  return run;
}

export function getRun(id: string): Run | null {
  return runs.get(id) ?? null;
}

/**
 * Append an event: validate, stamp, buffer, persist, fan out.
 *
 * Order matters. The event is buffered and written to the ledger BEFORE
 * subscribers are notified, so a subscriber that throws cannot lose the event,
 * and a stream attaching between two appends can never see event N+1 without
 * event N.
 */
export function emit(id: string, event: RunEvent): void {
  const run = runs.get(id);
  if (!run) return;

  // A finished run is closed. A late event from a stray timer must not reopen it
  // and leave the client's spinner running forever.
  if (run.state === "done" || run.state === "failed") return;

  const check = validateEvent(event);
  if (!check.ok) {
    // Loud, at the emit site. A malformed event reaches the client as a silent
    // no-op, which is the worst possible failure mode for a streaming UI.
    throw new Error(`run ${id}: ${check.reason}`);
  }

  const stamped: RunEvent = { ...event, at: Date.now() };
  run.events.push(stamped);

  // Fold the accounting the handoff requires per run (§1 invariant 3).
  if (stamped.type === "usage") {
    run.tokensIn += Number(stamped.tokensIn) || 0;
    run.tokensOut += Number(stamped.tokensOut) || 0;
    run.costUsd += Number(stamped.costUsd) || 0;
  }
  if (stamped.type === "gate") {
    run.state = "suspended";
    run.gateId = String(stamped.gateId);
  }
  if (stamped.type === "step" && run.state === "planned") run.state = "running";
  if (Array.isArray(stamped.files)) {
    for (const f of stamped.files as unknown[]) if (typeof f === "string") run.files.push(f);
  }
  if (isTerminal(stamped)) {
    run.state = stamped.type === "done" ? "done" : "failed";
    run.ms = Date.now() - run.startedAt;
    run.gateId = undefined;
  }

  appendLedger(id, stamped);

  for (const fn of subscribers.get(id) ?? []) {
    try {
      fn(stamped);
    } catch {
      // A dead stream must not stop the run or starve the other subscribers.
    }
  }
}

/** Resume a run parked on a gate. */
export function resume(id: string): void {
  const run = runs.get(id);
  if (!run || run.state !== "suspended") return;
  run.state = "running";
  run.gateId = undefined;
}

/**
 * Subscribe to a run. Returns an unsubscribe function.
 *
 * `replay` hands over everything buffered so far before live events start. This
 * is what makes the normal flow work: the client receives a runId from the
 * intent call and opens the stream a tick later, by which time the plan event —
 * and possibly the first step — has already been emitted.
 */
export function subscribe(id: string, fn: Subscriber, opts: { replay?: boolean } = {}): () => void {
  const run = runs.get(id);
  if (!run) return () => {};
  if (opts.replay !== false) {
    for (const e of [...run.events]) {
      try {
        fn(e);
      } catch {
        /* ignore */
      }
    }
  }
  let set = subscribers.get(id);
  if (!set) {
    set = new Set();
    subscribers.set(id, set);
  }
  set.add(fn);
  return () => {
    set?.delete(fn);
  };
}

/** Has this run already ended? Lets a stream close immediately after replay. */
export function isFinished(id: string): boolean {
  const run = runs.get(id);
  return !!run && (run.state === "done" || run.state === "failed");
}

function appendLedger(id: string, event: RunEvent): void {
  try {
    fs.mkdirSync(runsDir(), { recursive: true });
    fs.appendFileSync(ledgerPath(id), encodeEvent(event), "utf8");
  } catch {
    // The ledger is an audit convenience, not the run's correctness. A read-only
    // or full disk must not take the run down with it — the in-memory buffer
    // still serves the stream.
  }
}

/** Read a run's ledger back off disk — the after-the-fact audit path. */
export function readLedger(id: string): RunEvent[] {
  // Guard the id: it reaches the filesystem, and `..` in a runId would read an
  // arbitrary file. Only the shape newRunId() produces is accepted.
  if (!/^r_[a-f0-9]{1,64}$/.test(id)) return [];
  try {
    return fs
      .readFileSync(ledgerPath(id), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l) as RunEvent;
        } catch {
          return null;
        }
      })
      .filter((e): e is RunEvent => e !== null);
  } catch {
    return [];
  }
}

/** Live runs, newest first — for the Workers surface. */
export function listRuns(): Run[] {
  return [...runs.values()].sort((a, b) => b.startedAt - a.startedAt);
}
