import { logoutCookie } from "@/lib/auth/session.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const setCookie = logoutCookie(req);
  return Response.json({ ok: true }, { headers: { "Set-Cookie": setCookie } });
}
