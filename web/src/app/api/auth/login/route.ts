import { verifyCredentials, loginThrottleRemainingMs, recordLoginFailure, recordLoginSuccess } from "@/lib/auth/db.mjs";
import { loginCookie } from "@/lib/auth/session.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Per-email exponential-backoff brute-force throttle, persisted in the
// accounts DB (see db.mjs's "Login brute-force throttle" section) rather than
// an in-process Map — the Phase 1 version reset on every deploy/restart.

export async function POST(req: Request) {
  let body: { email?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const email = (typeof body.email === "string" ? body.email : "").trim().toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) return Response.json({ error: "email and password required" }, { status: 400 });

  const wait = loginThrottleRemainingMs(email);
  if (wait > 0) {
    return Response.json(
      { error: "Too many attempts — try again shortly." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(wait / 1000)) } },
    );
  }

  const user = verifyCredentials(email, password);
  if (!user) {
    recordLoginFailure(email);
    // Same message whether the email doesn't exist or the password is wrong
    // — verifyCredentials already collapses that distinction; the client
    // must not be able to tell registered emails apart from unregistered ones.
    return Response.json({ error: "Invalid email or password." }, { status: 401 });
  }
  recordLoginSuccess(email);

  const setCookie = loginCookie(user.id);
  return Response.json({ ok: true, user }, { headers: { "Set-Cookie": setCookie } });
}
