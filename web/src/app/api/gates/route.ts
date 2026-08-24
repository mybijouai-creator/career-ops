import { listPending } from "@/lib/gates/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/gates — the pending-gate list behind the Apply surface and the
 * Today decision queue ("3 parked for a human").
 *
 * Deliberately does NOT include gate tokens. This listing is reachable without
 * having seen a diff, which is exactly the case the token exists to refuse; a
 * caller that wants to approve has to have been on the stream.
 */
export async function GET() {
  return Response.json({ gates: listPending() });
}
