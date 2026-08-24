import { runDiscovery } from "@/lib/core/scan";
import { DEFAULT_FILTERS } from "@/lib/explore";
import { readApplications } from "@/lib/career-ops";
import { canSpend, capFromEnv, workerById } from "@/lib/workers/core.mjs";
import { addSpend, getSpend, getWorker, patchWorker } from "@/lib/workers/state";
import { sendPush } from "@/lib/push/send";
import { createRun, emit } from "@/lib/runs/store";

/**
 * run.ts — what each worker actually does.
 *
 * Every worker reports through the same run store as a user-initiated run, so
 * the Workers surface and the agent console render worker output with the same
 * components. A worker is not a second kind of execution; it is a run nobody
 * typed.
 *
 * The spend ceiling is re-checked HERE as well as in the tick that selected the
 * worker. The two checks are not redundant: the tick's answer can be minutes old
 * by the time a queued worker starts, and a manual trigger bypasses the tick
 * entirely.
 */

export type WorkerResult = { ok: boolean; note: string; count?: number };

export async function runWorker(id: string, opts: { manual?: boolean } = {}): Promise<WorkerResult> {
  const worker = workerById(id);
  if (!worker) return { ok: false, note: `no worker "${id}"` };

  const existing = getWorker(id);
  if (existing.running) return { ok: false, note: "already running" };

  const gate = canSpend(worker, getSpend(), capFromEnv(process.env));
  if (!gate.ok) {
    patchWorker(id, { lastNote: gate.reason, lastOk: false });
    return { ok: false, note: gate.reason };
  }

  const started = Date.now();
  patchWorker(id, { running: true });

  const run = createRun({
    input: opts.manual ? `worker ${id} (manual)` : `worker ${id}`,
    plan: [{ mode: id, label: worker.label, estCostUsd: 0, gated: false }],
    chain: [id],
    estCostUsd: 0,
  });
  emit(run.id, { type: "step", i: 0, state: "running", label: worker.label, ms: 0, costUsd: 0 });

  let result: WorkerResult;
  try {
    result = await execute(id, run.id);
  } catch (e) {
    result = { ok: false, note: e instanceof Error ? e.message : "the worker failed" };
  }

  const ms = Date.now() - started;
  patchWorker(id, { running: false, lastRunAt: Date.now(), lastOk: result.ok, lastNote: result.note, lastMs: ms });

  emit(run.id, { type: "step", i: 0, state: result.ok ? "done" : "failed", label: worker.label, ms, costUsd: 0 });
  if (result.ok) {
    emit(run.id, { type: "done", ms, costUsd: 0, files: [] });
    // Only notify when there is something to act on. A push saying "the scan
    // found nothing" trains the user to ignore the next one, which is the only
    // failure mode a notification system really has.
    if (result.count && result.count > 0) {
      void sendPush({
        kind: "worker_done",
        title: `${worker.label}: ${result.count}`,
        body: result.note,
        tag: `worker-${id}`,
      }).catch(() => {});
    }
  } else {
    emit(run.id, { type: "error", code: "worker_failed", message: result.note, retryable: true });
  }

  return result;
}

async function execute(id: string, runId: string): Promise<WorkerResult> {
  if (id === "scan") {
    // Zero tokens: HTTP + JSON against public boards, no model in the path.
    const offers = await runDiscovery(DEFAULT_FILTERS, () => {});
    emit(runId, {
      type: "artifact",
      kind: "triage_list",
      data: { count: offers.length, offers: offers.slice(0, 25) },
    });
    return { ok: true, note: `${offers.length} postings found · 0 tokens`, count: offers.length };
  }

  if (id === "liveness") {
    // Which tracked rows are still open enough to be worth rechecking. Terminal
    // states are skipped: re-verifying a posting for a job that was rejected two
    // months ago is pure noise.
    const open = readApplications().filter((a) => /^(applied|responded|interview|offer)/i.test(a.status));
    emit(runId, {
      type: "artifact",
      kind: "triage_list",
      data: { checked: open.length, note: "liveness recheck is queued per row from the Pipeline surface" },
    });
    // Honest scope: the recheck itself is the core's check-liveness.mjs against a
    // posting URL, and the tracker does not carry URLs for every row. Rather
    // than guess a URL per row, this reports what IS actionable and leaves the
    // per-row recheck to the Pipeline surface, which has the URL.
    return { ok: true, note: `${open.length} live rows reviewed · 0 tokens`, count: 0 };
  }

  if (id === "batch-eval") {
    // Deliberately not implemented as an automatic spend yet. Evaluating the
    // backlog unattended is the one worker that can run up a bill without a
    // human in the loop, and the honest sequencing is: ship the ceiling and the
    // reporting first, then let it spend.
    //
    // Reporting a fake success here would be worse than reporting this.
    addSpend(0);
    return {
      ok: false,
      note: "not enabled: automatic evaluation is held until the per-mode ceiling is wired to the scorer, so it cannot spend unattended",
    };
  }

  return { ok: false, note: `no implementation for "${id}"` };
}
