import { rejectGate } from "@/lib/gates/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/gates/:gateId/reject — HANDOFF.md §5 step 4.
 *
 * "reject discards; nothing is written." The run is resumed so it can finish
 * cleanly rather than being left suspended forever, and the ledger records the
 * refusal — a discarded gate is as much a compliance fact as an approved one,
 * and the approve/edit/discard mix is one of the §8 KPIs.
 */
export async function POST(req: Request, ctx: { params: Promise<{ gateId: string }> }) {
  const { gateId } = await ctx.params;
  let body: { token?: unknown; note?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* token may be in the header instead */
  }
  const token = typeof body.token === "string" ? body.token : (req.headers.get("x-gate-token") ?? "");
  const note = typeof body.note === "string" ? body.note.slice(0, 300) : undefined;

  const result = await rejectGate(gateId, token, note);
  if (!result.ok) return Response.json({ error: result.reason }, { status: result.status });
  return Response.json({ ok: true });
}
