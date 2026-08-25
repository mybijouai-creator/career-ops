import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { withTenantHandler } from "@/lib/auth/with-tenant.mjs";

// A basename only — cv-history.tsv stores exact output/ filenames, generated
// entirely by pdf-paths.mjs's own slugify()+date convention, never
// user-typed. Still validated before touching the filesystem: this is a
// dynamic route segment, so an arbitrary string reaches here on every
// request regardless of what a well-behaved client sends.
const SAFE_BASENAME = /^[a-zA-Z0-9._-]+\.pdf$/;

/**
 * GET /api/cvs/history/file/:name — serve one EXACT historical tailored CV by
 * its recorded output/ filename (data/cv-history.tsv). Unlike /api/cv-pdf
 * (which fuzzy-matches the newest PDF for a company), this always returns the
 * specific file a given history row points at — the two can diverge once a
 * company has more than one tailored CV on record.
 */
export const GET = withTenantHandler(async (_req: Request, ctx: { params: Promise<{ name: string }> }) => {
  const { name } = await ctx.params;
  if (!SAFE_BASENAME.test(name)) return new Response("not found", { status: 404 });

  const dir = path.join(careerOpsRoot(), "output");
  const file = path.join(dir, name);
  // path.join collapses ".." segments, but SAFE_BASENAME already rejects any
  // "/" or ".." before this point — belt and suspenders, cheap to keep.
  if (path.dirname(file) !== dir) return new Response("not found", { status: 404 });

  try {
    const buf = fs.readFileSync(file);
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${name}"`, "Cache-Control": "no-store" },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
});
