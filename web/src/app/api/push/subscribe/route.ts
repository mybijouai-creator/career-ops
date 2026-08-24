import { addSubscription, removeSubscription } from "@/lib/push/send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/push/subscribe — store a browser's push subscription. */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const result = addSubscription(body, req.headers.get("user-agent") ?? undefined);
  if (!result.ok) return Response.json({ error: result.reason }, { status: 400 });
  return Response.json({ ok: true });
}

/** DELETE /api/push/subscribe — drop it again (the user turned notifications off). */
export async function DELETE(req: Request) {
  let body: { endpoint?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  if (typeof body.endpoint !== "string") return Response.json({ error: "endpoint required" }, { status: 400 });
  removeSubscription(body.endpoint);
  return Response.json({ ok: true });
}
