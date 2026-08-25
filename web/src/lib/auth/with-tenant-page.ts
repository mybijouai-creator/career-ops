/**
 * with-tenant-page.ts — the page-render counterpart to with-tenant.mjs.
 *
 * withTenantHandler wraps every API route handler (Request in, tenant context
 * set for its call tree) — but a Next.js Server Component page is invoked
 * with no Request object at all, only next/headers' cookies(). Six pages
 * (page.tsx, pipeline/page.tsx, pipeline/[id]/page.tsx, prep/page.tsx,
 * explore/page.tsx, analytics/page.tsx) call career-ops.ts functions
 * directly during their own render, completely outside any withTenantHandler
 * call — so for a signed-in multi-tenant user, viewing any of these pages
 * read/wrote the single-tenant shared root instead of that user's own tenant
 * root, exactly the gap withTenantHandler exists to close for API routes.
 *
 * `.ts`, not `.mjs`, because next/headers is only importable inside a real
 * Next.js request — a plain `node --test` run of a `.mjs` file would throw on
 * import. with-tenant.mjs's withTenantForUser() (Request-free — takes an
 * already-resolved user) is the shared core both this and the API-route path
 * reduce to, so the actual tenant-resolution logic isn't duplicated here.
 */
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "./session.mjs";
import { findSessionUser } from "./db.mjs";
import { withTenantForUser } from "./with-tenant.mjs";

/**
 * Run a Server Component page's data-reading body inside the signed-in
 * viewer's own tenant context (or, with no valid session, unchanged —
 * the original single-tenant shared root, same fallback withTenantHandler
 * gives every API route).
 *
 *   export default async function Page() {
 *     return withTenantPage(() => {
 *       const data = pipelineSummary(); // now tenant-scoped
 *       return <PipelineView ... />;
 *     });
 *   }
 */
export async function withTenantPage<T>(fn: () => T | Promise<T>): Promise<T> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value ?? null;
  const user = token ? findSessionUser(token) : null;
  return withTenantForUser(user, fn);
}
