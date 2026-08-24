import { careerOpsRoot } from "@/lib/career-ops";
import { withTenantHandler } from "@/lib/auth/with-tenant.mjs";
import { listCvs, createCv } from "@/lib/cv-library.mjs";

/**
 * GET  /api/cvs        — list every named CV for this tenant (metadata only).
 * POST /api/cvs { name, content? } — create a new named CV. The first CV a
 * tenant ever creates becomes active automatically (see cv-library.mjs).
 */
export const GET = withTenantHandler(async () => {
  return Response.json(listCvs(careerOpsRoot()));
});

export const POST = withTenantHandler(async (req: Request) => {
  let body: { name?: unknown; content?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  if (typeof body.name !== "string" || !body.name.trim()) {
    return Response.json({ error: "name required" }, { status: 400 });
  }
  const content = typeof body.content === "string" ? body.content : "";
  try {
    const cv = createCv(careerOpsRoot(), { name: body.name, content });
    return Response.json({ ok: true, cv }, { status: 201 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "could not create CV" }, { status: 400 });
  }
});
