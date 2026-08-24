import { careerOpsRoot } from "@/lib/career-ops";
import { withTenantHandler } from "@/lib/auth/with-tenant.mjs";
import { readCvHistory } from "@/lib/cv-history.mjs";

/**
 * GET /api/cvs/history — every tailored CV a web `pdf` run has actually
 * rendered for this tenant, newest first. See cv-history.mjs for why this is
 * a separate, structured log rather than re-deriving it from output/*.pdf
 * filenames the way /api/cv-pdf does.
 */
export const GET = withTenantHandler(async () => {
  return Response.json(readCvHistory(careerOpsRoot()));
});
