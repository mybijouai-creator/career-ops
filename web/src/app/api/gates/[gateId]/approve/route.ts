import { approveGate } from "@/lib/gates/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The approved continuation does the real work (a CV render can take ~40s).
export const maxDuration = 800;

/**
 * POST /api/gates/:gateId/approve — HANDOFF.md §5 step 3.
 *
 * The gate token is required and is read from the body or the X-Gate-Token
 * header. It is minted when the gate opens and delivered only on the run's
 * stream, so possessing it proves the caller is the client that was shown the
 * diff — see lib/gates/core.mjs for why that is the strongest binding available
 * without a login, and for why it is not the same as knowing WHO approved.
 *
 * There is no bypass parameter. HANDOFF §1: "There is no toggle to disable this."
 */
export async function POST(req: Request, ctx: { params: Promise<{ gateId: string }> }) {
  const { gateId } = await ctx.params;
  let body: { token?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* token may be in the header instead */
  }
  const token = typeof body.token === "string" ? body.token : (req.headers.get("x-gate-token") ?? "");

  const result = await approveGate(gateId, token);
  if (!result.ok) return Response.json({ error: result.reason }, { status: result.status });
  return Response.json({ ok: true, files: result.files });
}
