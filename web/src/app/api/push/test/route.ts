import { sendPush } from "@/lib/push/send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/push/test — send one notification to this user's own devices.
 *
 * Exists because push has a long, silent failure chain: permission, service
 * worker, VAPID key match, and the push service itself. Without a way to fire
 * one on demand, the first real notification is also the first test, and a
 * failure looks identical to "nothing has happened yet".
 *
 * Fixed `worker_done` kind and fixed copy — this cannot be used to send
 * arbitrary text to the user's lock screen.
 */
export async function POST() {
  const result = await sendPush({
    kind: "worker_done",
    title: "career-ops notifications are working",
    body: "This is a test. Real ones arrive when a worker finishes or a follow-up comes due.",
    tag: "push-test",
  });
  return Response.json(result);
}
