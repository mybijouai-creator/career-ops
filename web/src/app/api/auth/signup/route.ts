import { createUser, AuthError } from "@/lib/auth/db.mjs";
import { loginCookie } from "@/lib/auth/session.mjs";

export const runtime = "nodejs"; // node:sqlite requires the Node runtime, not edge
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { email?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const email = typeof body.email === "string" ? body.email : "";
  const password = typeof body.password === "string" ? body.password : "";

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
