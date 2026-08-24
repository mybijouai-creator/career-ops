/**
 * with-tenant.mjs — the one line every user-data route adds to become
 * tenant-aware: `return withTenant(req, () => { ...existing handler... })`.
 *
 * Policy, deliberately: a request with NO valid session runs with NO tenant
 * context set — meaning it falls through to career-ops.ts's original
 * CAREER_OPS_ROOT/cwd resolution, i.e. today's single-tenant shared root,
 * completely unchanged. A single-tenant deployment that has never had anyone
 * sign up therefore behaves exactly as it did before this file existed: every
 * request is anonymous, every request reads/writes the one shared root.
 *
 * Only once a request actually carries a valid session does it get its own
 * isolated root (and, if it has one stored, its own provider API key made
 * available to anything it spawns). This is what makes multi-tenancy
 * additive rather than a breaking change gated behind a big-bang cutover:
 * the two modes coexist on the same deployment, decided per-request by
 * whether that request is signed in, not by a global switch.
 */
import { getSessionUser } from "./session.mjs";
import { ensureTenantRoot } from "./tenant-provision.mjs";
import { runWithTenantContext } from "./tenant-context.mjs";
import { getApiKeySecret } from "./db.mjs";
import { getMasterKey } from "./crypto.mjs";

const PROVIDER_ENV_VAR = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GEMINI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

/** `{}` (no addition) unless this user has a stored key AND the deployment
 *  has CAREER_OPS_ENCRYPTION_KEY configured to decrypt it — resolved once
 *  here, at the one place in the whole request that has both the session
 *  and a reason to touch the accounts db, rather than redone by every
 *  downstream spawn call site. */
function apiKeyEnvFor(userId) {
  let masterKey;
  try {
    masterKey = getMasterKey();
  } catch {
    return {}; // multi-tenant API-key storage isn't configured on this deployment
  }
  const secret = getApiKeySecret(userId, masterKey);
  if (!secret) return {};
  const varName = PROVIDER_ENV_VAR[secret.provider];
  return varName ? { [varName]: secret.key } : {};
}

export function withTenant(req, fn) {
  const user = getSessionUser(req);
  if (!user) return fn();
  const root = ensureTenantRoot(user.id);
  const apiKeyEnv = apiKeyEnvFor(user.id);
  return runWithTenantContext(root, apiKeyEnv, fn);
}

/**
 * Wrap a whole Next.js route handler (GET/POST/etc.) instead of calling
 * withTenant() inline in its body. Next always invokes a route handler with
 * the Request as its first argument even when the handler's own signature
 * doesn't declare one (e.g. a bare `GET()`) — this wrapper takes it from
 * there and forwards every argument (Request, and a dynamic route's
 * `{ params }` second argument) through unchanged, so no call site's
 * signature has to change to adopt this.
 *
 *   export const POST = withTenantHandler(async (req: Request) => { ... });
 */
export function withTenantHandler(handler) {
  return (req, ...rest) => withTenant(req, () => handler(req, ...rest));
}
