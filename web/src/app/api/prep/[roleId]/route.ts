import { findApplication, findReportFile } from "@/lib/career-ops";
import { createRun, emit } from "@/lib/runs/store";
import { executeStep } from "@/lib/runs/execute";
import { prepPrompt } from "@/lib/runs/prompts.mjs";
import { MODE_COST_USD } from "@/lib/runs/router.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

/**
 * POST /api/prep/:roleId — HANDOFF.md §2's `POST /api/prep/:roleId`, the route
 * the Interviews surface was previously stubbed against.
 *
 * Ungated: prep writes only into interview-prep/, which is the user's own
 * working notes rather than an outward-facing artifact, and it sends nothing.
 * It does SPEND, so the plan is still priced and reported like any other run.
 *
 * Returns `{ runId }` immediately and does the work in the background, because a
 * prep run takes minutes — the client follows /api/runs/:runId/stream. Same
 * shape as the intent route, so the console needs no special case for it.
 */
export async function POST(req: Request, ctx: { params: Promise<{ roleId: string }> }) {
  const { roleId } = await ctx.params;
  if (!/^\d+$/.test(roleId)) {
    return Response.json({ error: "a numeric tracker row number is required" }, { status: 400 });
  }

  const app = findApplication(roleId);
  if (!app) {
    return Response.json({ error: `no tracker row #${roleId}` }, { status: 404 });
  }

  let cliId: string | null = null;
  try {
    const body = (await req.json()) as { cliId?: unknown };
    if (typeof body.cliId === "string") cliId = body.cliId;
  } catch {
    /* cliId is optional */
  }

  const label = `Prep the ${app.company} loop`;
  const plan = [{ mode: "prep", label, estCostUsd: MODE_COST_USD.prep, gated: false }];
  const run = createRun({ input: `prep #${roleId}`, plan, chain: ["prep"], estCostUsd: MODE_COST_USD.prep });

  const prompt = prepPrompt({
    company: app.company,
    role: app.role,
    reportPath: findReportFile(roleId),
    today: new Date().toISOString().slice(0, 10),
  });

  // Deliberately not awaited: the response carries the runId so the client can
  // attach to the stream, and the run continues past this handler. Errors are
  // reported ON the stream rather than thrown into a response nobody is reading.
  void (async () => {
    const result = await executeStep({ runId: run.id, i: 0, mode: "prep", label, prompt, cliId });
    if (!result.ok) return; // executeStep already emitted step:failed + error
    emit(run.id, {
      type: "artifact",
      kind: "prep_plan",
      data: { company: app.company, role: app.role, summary: result.text.slice(-2000) },
      files: [`interview-prep/`],
    });
    emit(run.id, { type: "done", ms: 0, costUsd: 0, files: [] });
  })();

  return Response.json({ runId: run.id, plan, estCostUsd: MODE_COST_USD.prep });
}
