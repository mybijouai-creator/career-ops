import { getSessionUser } from "@/lib/auth/session.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = getSessionUser(req);
  if (!user) return Response.json({ authenticated: false }, { status: 401 });
  return Response.json({ authenticated: true, user });
}
