import { classify } from "@/lib/runs/router.mjs";
import { createRun } from "@/lib/runs/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/agent/intent — HANDOFF.md §3, "what replaces the CLI".
 *
 * Takes free text, a URL or a file drop and returns `{ runId, plan }`. The
 * critical property is in the handoff's own wording: the router "returns the plan
 * **before executing**, so the UI can price it".
 *
 * So this route does NOT run anything. It classifies, reserves a run, emits the
 * `plan` event, and stops. Execution starts only when the client opens the
 * stream and confirms, which is what makes the plan card refusable — a router
 * that executed first and reported after could not be declined, and every
 * cost-honesty guarantee in §1 would be decoration.
 *
 * Untrusted input: the text may be a pasted job description, which AGENTS.md
 * treats as data and never as instructions. Nothing here interprets it — it is
 * matched against a fixed keyword table in router.mjs and stored verbatim.
 */

const MAX_TEXT = 20_000;

export async function POST(req: Request) {
  let body: { text?: unknown; attachments?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.slice(0, MAX_TEXT) : "";
  const attachments = Array.isArray(body.attachments)
    ? body.attachments
        .slice(0, 10)
        .map((a) => (a && typeof a === "object" ? { name: String((a as { name?: unknown }).name ?? "") } : { name: "" }))
    : [];

  if (!text.trim() && attachments.length === 0) {
    return Response.json({ error: "text or attachments required" }, { status: 400 });
  }

  const { chain, plan, estCostUsd, urls, reason } = classify({ text, attachments });
  const run = createRun({ input: text, plan, chain, estCostUsd });

  return Response.json({
    runId: run.id,
    plan,
    chain,
    estCostUsd,
    // Surfaced so the plan card can explain ITSELF rather than just listing
    // steps: "2 postings — ranked against each other" is what tells the user the
    // router understood them, and is the cheapest possible correction loop.
    reason,
    urls,
    // No archetype yet: HANDOFF §3's example returns one, but detecting it needs
    // the evaluation that has not run. Reporting a guess here would put an
    // invented label on the plan card, so the field is omitted until `oferta`
    // produces a real one.
  });
}
