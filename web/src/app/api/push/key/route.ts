import { subscriptionCount, vapidKeys } from "@/lib/push/send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/push/key — the PUBLIC VAPID key the browser needs to subscribe.
 *
 * Only the public half is ever returned. `available: false` lets the UI hide the
 * subscribe button rather than offer one that cannot work, which is the case on
 * a read-only config directory.
 */
export async function GET() {
  const keys = vapidKeys();
  if (!keys) return Response.json({ available: false, subscriptions: 0 });
  return Response.json({ available: true, publicKey: keys.publicKey, subscriptions: subscriptionCount() });
}
