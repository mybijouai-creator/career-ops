import { capFromEnv, dueWorkers } from "@/lib/workers/core.mjs";
import { clearStaleRunning, getSpend, readState } from "@/lib/workers/state";
import { runWorker } from "@/lib/workers/run";

/**
 * scheduler.ts — the tick that starts due workers.
 *
 * A module-level interval, started lazily on the first request that touches the
 * workers API. Deliberately NOT started at import time: Next imports route
 * modules during `next build`, and a scheduler that woke up in CI would run the
 * user's scan on a build machine.
 *
 * This is a local-first app with a single Node process, so an in-process timer is
 * the right size of mechanism — there is no second replica to coordinate with.
 * It is not a job queue and does not pretend to be: nothing here retries a
 * failed worker beyond its next natural due time, because a scan that failed
 * because a board is down should wait, not hammer it.
 *
 * KNOWN GAP (multi-tenant): this timer runs process-wide, outside any
 * request's AsyncLocalStorage tenant context (see web/src/lib/auth/
 * tenant-context.mjs). It always resolves the single shared/default
 * CAREER_OPS_ROOT, never a signed-up user's own tenants/{userId}/ tree — so on
 * a deployment with accounts enabled, automatic background scanning still
 * only covers the default root. Each tenant can still trigger their own work
 * on demand through the normal request-scoped routes, which ARE isolated.
 * Tracked in DEPLOY.md and DATA_CONTRACT.md; not yet fixed.
 *
 * Opt out with CAREER_OPS_WORKERS=off.
 */

const TICK_MS = 5 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;
let started = false;

export function schedulerEnabled(): boolean {
  return (process.env.CAREER_OPS_WORKERS ?? "").trim().toLowerCase() !== "off";
}

export function ensureScheduler(): void {
  if (started || !schedulerEnabled()) return;
  started = true;

  // A process that died mid-run leaves `running: true` and the worker never
  // fires again. Nothing is running at start by definition, so this is the safe
  // place to clear it.
  clearStaleRunning();

  const tick = () => {
    try {
      const state = readState();
      for (const worker of dueWorkers(state.workers, getSpend(), capFromEnv(process.env))) {
        // Not awaited: workers run concurrently and a slow scan must not delay
        // the liveness recheck. Each one guards its own `running` flag.
        void runWorker(worker.id).catch(() => {});
      }
    } catch {
      // A tick that throws must not kill the interval — that would silently end
      // all scheduling for the life of the process.
    }
  };

  timer = setInterval(tick, TICK_MS);
  // Do not hold the event loop open on account of the scheduler.
  timer.unref?.();
  // One tick shortly after boot rather than immediately, so a cold start serves
  // its first page before a scan competes for the network.
  const kick = setTimeout(tick, 20_000);
  kick.unref?.();
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}
