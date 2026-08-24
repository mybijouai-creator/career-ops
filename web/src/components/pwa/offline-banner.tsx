"use client";

import { CloudOff, RefreshCw } from "lucide-react";
import { usePwa } from "@/components/pwa/pwa-provider";

/** "4m ago" / "2h ago" — deliberately coarse; the point is staleness, not a clock. */
function ago(ms: number): string {
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * OfflineBanner — the offline state from the PWA prototype: how stale the cached
 * view is, and how many writes are waiting to replay.
 *
 * Shown while offline, and kept for one more beat while a queue drains so the
 * user sees their writes land rather than watching the count vanish silently.
 * Intents get their own line because they behave differently on reconnect: they
 * do NOT replay, they come back as a question.
 */
export function OfflineBanner() {
  const { online, queue, lastSyncAt, replay } = usePwa();
  const pending = queue.writes;
  const intents = queue.intents;

  if (online && pending === 0 && intents === 0) return null;

  return (
    <div
      role="status"
      className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2.5 text-amber-600 dark:text-amber-400"
    >
      <div className="flex items-center gap-2">
        <CloudOff className="size-4 shrink-0" aria-hidden />
        <span className="text-[11.5px] font-semibold">
          {online ? "Back online" : "Offline"}
          {lastSyncAt ? ` — cached ${ago(lastSyncAt)}` : ""}
        </span>
        {pending > 0 && (
          <span className="ml-auto font-mono text-[10px] text-faint">
            {pending} queued write{pending === 1 ? "" : "s"}
          </span>
        )}
        {online && pending > 0 && (
          <button
            type="button"
            onClick={() => void replay()}
            className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-border px-2 text-[11px] text-muted"
          >
            <RefreshCw className="size-3" aria-hidden />
            Replay
          </button>
        )}
      </div>
      {intents > 0 && (
        <p className="mt-1.5 text-[10.5px] leading-relaxed text-muted">
          {intents} approval{intents === 1 ? "" : "s"} captured offline —{" "}
          {online ? "re-confirm against live state in Settings." : "these never auto-approve on reconnect."}
        </p>
      )}
      {!online && (
        <p className="mt-1.5 text-[10.5px] leading-relaxed text-muted">
          Reports and the pipeline are readable. Writes queue and replay when you reconnect.
        </p>
      )}
    </div>
  );
}
