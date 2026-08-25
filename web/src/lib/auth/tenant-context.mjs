/**
 * tenant-context.mjs — the ambient "which tenant's files is this request
 * touching" signal, carried via AsyncLocalStorage rather than threaded as an
 * explicit parameter through every function that calls careerOpsRoot().
 *
 * Why ALS and not a parameter: career-ops.ts's careerOpsRoot() is called from
 * ~20 route handlers and dozens of functions beneath them, none of which take
 * a "root" argument today. Converting every one of those call sites' function
 * signatures to thread a root through would touch far more code, for the same
 * result, with far more chance of one call site being missed and silently
 * falling back to the wrong root. ALS instead makes careerOpsRoot() itself
 * tenant-aware: unchanged call sites automatically pick up the right root for
 * whichever request is currently running, and a single-tenant deployment
 * (nothing ever calls runWithTenant) sees zero behavior change — it just
 * never has anything in the store, so careerOpsRoot() falls through to its
 * original env-var/cwd resolution exactly as before this file existed.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const als = new AsyncLocalStorage();

/**
 * The store carries `{ root, apiKeyEnv }` rather than just the root string,
 * so a spawned-CLI env can be built correctly from ANY point in the call
 * tree — including a lib function several layers below the route handler
 * that has no access to the original Request (agent-interpret.ts,
 * drive.ts) — without threading the request itself that deep. `apiKeyEnv`
 * is either `{}` or a single `{ [ENV_VAR]: decryptedKey }` entry, resolved
 * once at the withTenant() boundary where the session (and hence the
 * request) is actually available.
 */

/** Run fn with `{ root, apiKeyEnv }` as the ambient tenant context for its
 *  whole call tree (including anything it awaits) — nested calls further
 *  down see it via currentTenantRoot()/currentApiKeyEnv() without it being
 *  passed explicitly. */
export function runWithTenantContext(root, apiKeyEnv, fn) {
  return als.run({ root, apiKeyEnv }, fn);
}

/** The current request's tenant root, or undefined outside any
 *  runWithTenantContext call (single-tenant mode, or a code path that
 *  legitimately has no tenant — e.g. a route handler that runs before
 *  authentication is resolved). */
export function currentTenantRoot() {
  return als.getStore()?.root;
}

/** The current request's resolved provider-API-key env addition (e.g.
 *  `{ ANTHROPIC_API_KEY: "sk-..." }`), or `{}` if there is none — never
 *  undefined, so a caller can always spread it directly into a spawn's env
 *  without an extra null check. */
export function currentApiKeyEnv() {
  return als.getStore()?.apiKeyEnv ?? {};
}
