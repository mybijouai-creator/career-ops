import { careerOpsRoot } from "@/lib/career-ops";
import { withTenantHandler } from "@/lib/auth/with-tenant.mjs";
import { getCv, updateCv, renameCv, deleteCv, isValidCvId } from "@/lib/cv-library.mjs";

/**
 * GET    /api/cvs/:cvId              — one CV's full content.
 * PUT    /api/cvs/:cvId { content, name? } — overwrite content, optionally rename in the same call.
 * DELETE /api/cvs/:cvId              — remove a non-active CV (refuses the active one — activate a different one first).
 */
export const GET = withTenantHandler(async (_req: Request, ctx: { params: Promise<{ cvId: string }> }) => {
  const { cvId } = await ctx.params;
  if (!isValidCvId(cvId)) return Response.json({ error: "not-found" }, { status: 404 });
  const cv = getCv(careerOpsRoot(), cvId);
  if (!cv) return Response.json({ error: "not-found" }, { status: 404 });
  return Response.json({ cv });
});

export const PUT = withTenantHandler(async (req: Request, ctx: { params: Promise<{ cvId: string }> }) => {
  const { cvId } = await ctx.params;
  if (!isValidCvId(cvId)) return Response.json({ error: "not-found" }, { status: 404 });

  let body: { content?: unknown; name?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }

  const root = careerOpsRoot();
  if (typeof body.name === "string" && body.name.trim()) {
    try {
      const renamed = renameCv(root, cvId, body.name);
      if (!renamed) return Response.json({ error: "not-found" }, { status: 404 });
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : "could not rename CV" }, { status: 400 });
    }
  }

  if (typeof body.content !== "string") {
    // A rename-only PUT is valid; a content-less PUT with no name is not.
    if (typeof body.name === "string") return Response.json({ ok: true });
    return Response.json({ error: "content required" }, { status: 400 });
  }

  try {
    const updated = updateCv(root, cvId, body.content);
    if (!updated) return Response.json({ error: "not-found" }, { status: 404 });
    return Response.json({ ok: true, cv: updated });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "could not save CV" }, { status: 400 });
  }
});

export const DELETE = withTenantHandler(async (_req: Request, ctx: { params: Promise<{ cvId: string }> }) => {
  const { cvId } = await ctx.params;
  if (!isValidCvId(cvId)) return Response.json({ error: "not-found" }, { status: 404 });
  const result = deleteCv(careerOpsRoot(), cvId);
  if (!result.ok) {
    const status = result.error === "not-found" ? 404 : 409;
    const message = result.error === "is-active" ? "Activate a different CV first, then delete this one." : "not-found";
    return Response.json({ error: message }, { status });
  }
  return Response.json({ ok: true });
});
