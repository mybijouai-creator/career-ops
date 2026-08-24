"use client";

import { useCallback, useEffect, useState } from "react";
import { Play, Loader2, Clock } from "lucide-react";
import { useToast } from "@/components/mobile/toast";

/**
 * BackgroundWorkers — status for the scheduled workers, and a way to run one now.
 *
 * The spend line is the point of this card. HANDOFF §1 invariant 3 requires a
 * per-day ceiling, and a ceiling the user cannot see is indistinguishable from
 * one that is not enforced — so the remaining budget is shown next to the worker
 * that can consume it.
 */

type Worker = {
  id: string;
  label: string;
  describe: string;
  costsTokens: boolean;
  due?: boolean;
  running?: boolean;
  lastRunAt?: number;
  lastOk?: boolean;
  lastNote?: string;
};

type Status = {
  schedulerEnabled: boolean;
  spend: { usd: number; capUsd: number; remainingUsd: number };
  workers: Worker[];
};

function ago(ms?: number): string {
  if (!ms) return "never";
  const mins = Math.round((Date.now() - ms) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

export function BackgroundWorkers() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/workers");
      if (r.ok) setStatus((await r.json()) as Status);
    } catch {
      /* offline — the card just stays as it was */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const trigger = async (id: string) => {
    setBusy(id);
    try {
      const r = await fetch("/api/workers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const d = (await r.json()) as { ok?: boolean; note?: string };
      toast(d.note ?? (r.ok ? "Done." : "Could not run that."), r.ok ? "ok" : "warn");
      await load();
    } catch {
      toast("Could not reach the server.", "warn");
    } finally {
      setBusy(null);
    }
  };

  if (!status) return null;

  return (
    <section>
      <h2 className="px-1 font-mono text-[9.5px] font-semibold uppercase tracking-[0.1em] text-faint">
        Background workers
        {!status.schedulerEnabled && (
          <span className="ml-1.5 normal-case text-amber-500 dark:text-amber-400">scheduler off</span>
        )}
      </h2>
      <div className="mt-2 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
        {status.workers.map((w) => (
          <div key={w.id} className="flex min-h-[56px] items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[12px] font-medium">{w.label}</span>
                <span
                  className={`rounded px-1 py-px text-[8.5px] font-semibold uppercase ${
                    w.costsTokens
                      ? "text-amber-600 ring-1 ring-amber-400/40 dark:text-amber-400"
                      : "text-emerald-600 ring-1 ring-emerald-400/40 dark:text-emerald-400"
                  }`}
                >
                  {w.costsTokens ? "spends" : "free"}
                </span>
              </div>
              <div className="truncate text-[10.5px] leading-snug text-faint">{w.lastNote ?? w.describe}</div>
              <div className="mt-0.5 flex items-center gap-1 font-mono text-[9.5px] text-faint">
                <Clock className="size-2.5" aria-hidden />
                {ago(w.lastRunAt)}
                {w.due && <span className="text-brand-text">· due</span>}
              </div>
            </div>
            <button
              type="button"
              disabled={busy === w.id || w.running}
              onClick={() => void trigger(w.id)}
              aria-label={`Run ${w.label} now`}
              className="inline-flex size-[34px] shrink-0 items-center justify-center rounded-lg border border-border text-muted disabled:opacity-40"
            >
              {busy === w.id || w.running ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <Play className="size-3.5" aria-hidden />
              )}
            </button>
          </div>
        ))}
      </div>
      <p className="mt-1.5 px-1 font-mono text-[10px] text-faint">
        spent today ${status.spend.usd.toFixed(2)} of ${status.spend.capUsd.toFixed(2)} · $
        {status.spend.remainingUsd.toFixed(2)} left
      </p>
    </section>
  );
}
