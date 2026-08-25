import { createUser, AuthError, signupThrottleRemainingMs, recordSignupAttempt } from "@/lib/auth/db.mjs";
import { loginCookie } from "@/lib/auth/session.mjs";
import { clientIp } from "@/lib/auth/client-ip.mjs";

export const runtime = "nodejs"; // node:sqlite requires the Node runtime, not edge
export const dynamic = "force-dynamic";

// Fixed-window per-IP signup limit (see db.mjs's "Signup rate limit" section)
// — an unthrottled signup both writes a users row and, once used, provisions
// a full tenant directory (Phase 2), so with no limit at all a script could
// fill the volume's disk and bloat the accounts table for free.
export async function POST(req: Request) {
  const ip = clientIp(req);
  const wait = signupThrottleRemainingMs(ip);
  if (wait > 0) {
    return Response.json(
      { error: "Too many accounts created from this connection — try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(wait / 1000)) } },
    );
  }

  let body: { email?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const email = typeof body.email === "string" ? body.email : "";
  const password = typeof body.password === "string" ? body.password : "";

  // Recorded regardless of outcome (including a validation failure) — the
  // point is bounding how many attempts this IP gets, not just how many
  // accounts it successfully creates.
  recordSignupAttempt(ip);

  let user;
  try {
    user = createUser(email, password);
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.code === "email_taken" ? 409 : 400;
      return Response.json({ error: e.message, code: e.code }, { status });
    }
    return Response.json({ error: "signup failed" }, { status: 500 });
  }

  const setCookie = loginCookie(user.id);
  return Response.json(
    { ok: true, user },
    { status: 201, headers: { "Set-Cookie": setCookie } },
  );
}
