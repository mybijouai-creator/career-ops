/**
 * platformRoot.mjs — where platform-wide (not per-tenant) state lives: the
 * accounts database, and anything else that must exist above every tenant's
 * own career-ops root rather than inside one of them.
 *
 * Deliberately its OWN function, separate from career-ops.ts's careerOpsRoot()
 * (which resolves to the user's *own* directory), even though today — before
 * per-tenant filesystem isolation exists — they resolve to the same place.
 * The day a request-scoped tenant root lands, only this function's body needs
 * to change (to "one level above the tenants/ directory"); every call site
 * that already imports platformRoot() for platform state stays correct
 * without being touched.
 */
import path from "node:path";

export function platformRoot() {
  const env = process.env.CAREER_OPS_ROOT?.trim();
  if (env) return env;
  return path.resolve(process.cwd(), "..");
}
