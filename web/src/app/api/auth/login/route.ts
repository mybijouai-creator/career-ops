import { verifyCredentials } from "@/lib/auth/db.mjs";
import { loginCookie } from "@/lib/auth/session.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Light, in-process brute-force throttle: per-email exponential backoff on
// failed attempts, reset on success. Intentionally simple for Phase 1 — an
// in-memory Map means it resets on every deploy/restart and doesn't share
// state across replicas, which is a real gap for a public multi-replica
// deployment. Tracked as a Phase 4 security-pass item, not silently ignored.
const FAILURES = new Map<string, { count: number; blockedUntil: number }>();
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;

function throttleFor(email: string): number {
  const rec = FAILURES.get(email);
  if (!rec) return 0;
  return Math.max(0, rec.blockedUntil - Date.now());
}

function recordFailure(email: string) {
  const rec = FAILURES.get(email) ?? { count: 0, blockedUntil: 0 };
  rec.count += 1;
  rec.blockedUntil = Date.now() + Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (rec.count - 1));
  FAILURES.set(email, rec);
}

function recordSuccess(email: string) {
  FAILURES.delete(email);
}

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

  const wait = throttleFor(email);
  if (wait > 0) {
    return Response.json(
      { error: "Too many attempts — try again shortly." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(wait / 1000)) } },
    );
  }

  const user = verifyCredentials(email, password);
  if (!user) {
    recordFailure(email);
    // Same message whether the email doesn't exist or the password is wrong
    // — verifyCredentials already collapses that distinction; the client
    // must not be able to tell registered emails apart from unregistered ones.
    return Response.json({ error: "Invalid email or password." }, { status: 401 });
  }
  recordSuccess(email);

  const setCookie = loginCookie(user.id);
  return Response.json({ ok: true, user }, { headers: { "Set-Cookie": setCookie } });
}
