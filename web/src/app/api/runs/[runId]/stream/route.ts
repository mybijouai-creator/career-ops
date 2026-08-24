import { encodeEvent } from "@/lib/runs/events.mjs";
import { getRun, isFinished, subscribe } from "@/lib/runs/store";
import { withTenantHandler } from "@/lib/auth/with-tenant.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A run can sit parked on a gate for a long time; the stream has to outlive that.
export const maxDuration = 800;

/**
 * GET /api/runs/:runId/stream — the streaming contract, HANDOFF.md §4.
 *
 * Newline-delimited JSON rather than `text/event-stream`. The handoff specifies
 * "newline-delimited JSON events", and the repo already reads ndjson elsewhere
 * (/api/explore, stream-parse.mjs), so this reuses that client-side plumbing
 * instead of introducing a second framing for the same job.
 *
 * Buffered events are replayed before live ones. That is the normal path, not a
 * recovery case: the client gets its runId from /api/agent/intent and opens this
 * a tick later, by which point the `plan` event already exists.
 *
 * Only `gate` blocks. Everything else is advisory — the console renders it and
 * the run continues.
 */
export const GET = withTenantHandler(async (_req: Request, ctx: { params: Promise<{ runId: string }> }) => {
  const { runId } = await ctx.params;
  const run = getRun(runId);

  if (!run) {
    return Response.json({ error: `no live run ${runId}` }, { status: 404 });
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  // Set by cancel() so a write attempted between "client gone" and "unsubscribed"
  // does not throw into the run.
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(encodeEvent(event)));
        } catch {
          closed = true;
        }
      };

      unsubscribe = subscribe(runId, (event) => {
        send(event);
        // Close on a terminal event rather than waiting for a timeout, so the
        // client's reader loop ends on its own.
        if (event.type === "done" || event.type === "error") {
          closed = true;
          unsubscribe?.();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      });

      // A run that finished before the stream attached: the replay above already
      // delivered its terminal event, so close now instead of holding a socket
      // open for a run that will never emit again.
      if (isFinished(runId)) {
        closed = true;
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      // The client navigated away or the tab closed. Drop the subscription —
      // otherwise every abandoned stream leaks a subscriber for the run's life.
      closed = true;
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      // Defeats proxy buffering, which would otherwise hold events until the run
      // ended and make a streaming UI arrive all at once.
      "X-Accel-Buffering": "no",
    },
  });
});
