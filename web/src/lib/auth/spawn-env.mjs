/**
 * spawn-env.mjs — the environment a spawned CLI child process actually needs,
 * for every call site that runs one on a request's behalf.
 *
 * Two things a child process needs that it can't get by inheriting
 * process.env alone:
 *
 *  1. CAREER_OPS_ROOT explicitly set to the CURRENT request's root. cwd
 *     already gets this right via career-ops.ts's AsyncLocalStorage-aware
 *     careerOpsRoot() — but core scripts (tracker-utils.mjs and friends) read
 *     CAREER_OPS_ROOT from their OWN process.env directly, and a child
 *     process shares none of the parent's AsyncLocalStorage. Without this,
 *     an authenticated request's spawned CLI would still read/write the
 *     single-tenant shared root even though the web server resolved the
 *     right tenant root for itself.
 *
 *  2. The signed-in user's OWN provider API key, decrypted once at the
 *     withTenant() boundary and carried in the SAME ambient context as the
 *     tenant root (tenant-context.mjs) — never persisted anywhere outside
 *     the encrypted row it came from, never logged, never returned in any
 *     response.
 *
 * Reads entirely from the ambient tenant context rather than taking a
 * Request parameter, on purpose: some spawn call sites (agent-interpret.ts,
 * drive.ts) are library functions several layers below the route handler,
 * with no access to the original Request at all. Since withTenant() already
 * resolved everything this needs into the AsyncLocalStorage context before
 * calling into any of that code, this can be a zero-argument call from
 * anywhere in the same async call tree. Outside any withTenant() call
 * (single-tenant mode, nobody signed in) this returns exactly
 * `{ ...process.env, CAREER_OPS_ROOT: careerOpsRoot() }` — additive, not a
 * behavior change for a deployment nobody has signed into.
 */
import path from "node:path";
import { currentTenantRoot, currentApiKeyEnv } from "./tenant-context.mjs";

// Mirrors career-ops.ts's careerOpsRoot() fallback order exactly (ambient
// tenant root, then CAREER_OPS_ROOT, then the app's own parent directory).
// Not imported directly from career-ops.ts — that file is TypeScript, and
// this one has to stay plain .mjs so `node --test` can load it without a
// bundler (see this repo's test conventions in web/README.md). Two lines of
// genuinely load-bearing duplication, not a shortcut: if that fallback order
// ever changes, this comment is the pointer back to keep them in sync.
function defaultCareerOpsRoot() {
  const tenant = currentTenantRoot();
  if (tenant) return tenant;
  const env = process.env.CAREER_OPS_ROOT?.trim();
  if (env) return env;
  return path.resolve(process.cwd(), "..");
}

export function spawnEnv() {
  return { ...process.env, CAREER_OPS_ROOT: defaultCareerOpsRoot(), ...currentApiKeyEnv() };
}
