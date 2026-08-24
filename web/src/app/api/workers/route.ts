import { WORKERS, capFromEnv, isDue } from "@/lib/workers/core.mjs";
import { getSpend, readState } from "@/lib/workers/state";
import { runWorker } from "@/lib/workers/run";
import { ensureScheduler, schedulerEnabled } from "@/lib/workers/scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

/**
 * GET /api/workers — worker status, the daily spend and the ceiling.
 * POST /api/workers { id } — trigger one now.
 *
 * The GET is also what starts the scheduler. Starting it at import time would
 * mean `next build` runs the user's scan on a build machine, so it is deferred
 * to the first real request that cares about workers.
 */
export async function GET() {
  ensureScheduler();
  const state = readState();
  const spend = getSpend();
  const cap = capFromEnv(process.env);
  return Response.json({
    schedulerEnabled: schedulerEnabled(),
    spend: { ...spend, capUsd: cap, remainingUsd: Math.max(0, cap - spend.usd) },
    workers: WORKERS.map((w) => ({
      id: w.id,
      label: w.label,
      describe: w.describe,
      costsTokens: w.costsTokens,
      everyMs: w.everyMs,
      ...state.workers[w.id],
      due: isDue(w, state.workers[w.id]),
    })),
  });
}

export async function POST(req: Request) {
  let body: { id?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  if (typeof body.id !== "string") return Response.json({ error: "id required" }, { status: 400 });

  const result = await runWorker(body.id, { manual: true });
  // A refusal (already running, or the ceiling reached) is a 409, not a 500:
  // nothing is broken, the request simply cannot be honoured right now.
  return Response.json(result, { status: result.ok ? 200 : 409 });
}
