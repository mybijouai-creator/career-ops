import { careerOpsRoot } from "@/lib/career-ops";
import { withTenantHandler } from "@/lib/auth/with-tenant.mjs";
import { activateCv, isValidCvId } from "@/lib/cv-library.mjs";

/**
 * POST /api/cvs/:cvId/activate — make this CV the one mirrored into cv.md,
 * so every existing mode/script/report (all of which read cv.md directly,
 * unaware multi-CV exists) picks it up on their very next read.
 */
export const POST = withTenantHandler(async (_req: Request, ctx: { params: Promise<{ cvId: string }> }) => {
  const { cvId } = await ctx.params;
  if (!isValidCvId(cvId)) return Response.json({ error: "not-found" }, { status: 404 });
  const result = activateCv(careerOpsRoot(), cvId);
  if (!result.ok) return Response.json({ error: "not-found" }, { status: 404 });
  return Response.json(result);
});
