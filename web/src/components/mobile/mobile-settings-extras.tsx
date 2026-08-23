"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Send, GraduationCap, FileText, Radar, Cpu, ChevronRight } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { usePwa } from "@/components/pwa/pwa-provider";
import { useToast } from "@/components/mobile/toast";
import { UsageMeter } from "@/components/usage-meter";
import type { QueuedEntry } from "@/lib/pwa/offline";
import { labelOf } from "@pwa/queue-core.mjs";

/**
 * Mobile-only additions to Settings, standing in for what the desktop sidebar
 * provides and the bottom tab bar cannot.
 *
 * Two jobs:
 *
 *   1. Reach the surfaces that are not one of the five tabs. The tab bar is
 *      deliberately five items; everything else has to be reachable from
 *      somewhere, and Settings is where the prototype puts it.
 *   2. Own the OFFLINE & DATA section — including the one interaction the
 *      offline contract actually requires a human for: re-confirming approvals
 *      that were captured while offline. Those are never replayed; they come
 *      back here as a question, against live state.
 */

type Dest = { href: string; label: string; note: string; icon: ComponentType<SVGProps<SVGSVGElement>> };

const MORE: Dest[] = [
  { href: "/followups", label: "Outreach", note: "cadence + drafts · the agent drafts, you send", icon: Send },
  { href: "/prep", label: "Interviews", note: "loop plans, story bank, gaps", icon: GraduationCap },
  { href: "/cv", label: "CV", note: "cv.md is the source of truth", icon: FileText },
  { href: "/portals", label: "Portals", note: "scan targets · zero tokens", icon: Radar },
  { href: "/jobs", label: "Workers", note: "run history and live jobs", icon: Cpu },
];

export function MobileSettingsExtras() {
  return (
    <div className="mt-8 space-y-6 md:hidden">
      <MoreNav />
      <OfflineAndData />
    </div>
  );
}

function MoreNav() {
  return (
    <section>
      <h2 className="px-1 font-mono text-[9.5px] font-semibold uppercase tracking-[0.1em] text-faint">More</h2>
      <ul className="mt-2 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
        {MORE.map(({ href, label, note, icon: Icon }) => (
          <li key={href}>
            <Link href={href} className="flex min-h-[56px] items-center gap-3 px-4 py-3">
              <Icon className="size-4 shrink-0 text-faint" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-medium">{label}</div>
                <div className="truncate text-[10.5px] text-faint">{note}</div>
              </div>
              <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

const SW_COPY: Record<string, { state: string; note: string; tone: string }> = {
  ready: { state: "on", note: "reports, pipeline and PDFs cached for offline reading", tone: "text-emerald-500 dark:text-emerald-400" },
  pending: { state: "…", note: "installing the offline worker", tone: "text-faint" },
  failed: { state: "off", note: "the offline worker could not install — the app still works online", tone: "text-amber-500 dark:text-amber-400" },
  unsupported: { state: "n/a", note: "this browser has no service worker, so nothing is cached", tone: "text-faint" },
};

function OfflineAndData() {
  const { online, queue, swState, replay } = usePwa();
  const sw = SW_COPY[swState] ?? SW_COPY.pending;

  return (
    <section>
      <h2 className="px-1 font-mono text-[9.5px] font-semibold uppercase tracking-[0.1em] text-faint">Offline &amp; data</h2>
      <div className="mt-2 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
        <Row name="Connection" note={online ? "live" : "offline — showing the cached view"} state={online ? "online" : "offline"} tone={online ? "text-emerald-500 dark:text-emerald-400" : "text-amber-500 dark:text-amber-400"} />
        <Row name="Cached for offline" note={sw.note} state={sw.state} tone={sw.tone} />
        <Row
          name="Queued writes"
          note={queue.writes > 0 ? "replay when the connection returns" : "nothing waiting"}
          state={String(queue.writes)}
          tone={queue.writes > 0 ? "text-amber-500 dark:text-amber-400" : "text-faint"}
          action={
            online && queue.writes > 0 ? (
              <button type="button" onClick={() => void replay()} className="min-h-[34px] rounded-lg border border-border px-2 text-[11px] text-muted">
                Replay now
              </button>
            ) : null
          }
        />
        <Row name="Gates offline" note="never auto-approve on reconnect" state="strict" tone="text-red-500 dark:text-red-400" />
      </div>

      <CapturedIntents />

      <p className="mt-2.5 px-1 text-[10.5px] leading-relaxed text-faint">
        Auto-submit is not a setting. There is no code path in career-ops that presses Submit on an application — the
        agent prepares, a human sends.
      </p>

      <div className="mt-5">
        <UsageMeter />
      </div>
    </section>
  );
}

function Row({
  name,
  note,
  state,
  tone,
  action,
}: {
  name: string;
  note: string;
  state: string;
  tone: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[52px] items-center gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium">{name}</div>
        <div className="text-[10.5px] leading-snug text-faint">{note}</div>
      </div>
      {action}
      <span className={`shrink-0 font-mono text-[9px] font-semibold uppercase tracking-[0.06em] ${tone}`}>{state}</span>
    </div>
  );
}

/**
 * Approvals captured while offline, re-presented for confirmation.
 *
 * This is the UI half of the rule that a stale diff must not be able to write:
 * the intent carries only what the user meant to do, and confirming it here
 * issues the request NOW, with the server free to reject it against current
 * state. Nothing about the original diff is trusted or replayed.
 */
function CapturedIntents() {
  const { queue, listIntents, confirmIntent, discardIntent, online } = usePwa();
  const { toast } = useToast();
  const [entries, setEntries] = useState<QueuedEntry[]>([]);
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    setEntries(await listIntents());
  }, [listIntents]);

  useEffect(() => {
    void load();
    // Re-read whenever the count changes, so confirming one row updates the list.
  }, [load, queue.intents]);

  if (entries.length === 0) return null;

  const confirm = async (entry: QueuedEntry) => {
    setBusy(entry.id);
    try {
      const res = await confirmIntent(entry);
      if (!res) {
        toast(`${labelOf(entry.action)} discarded — it has no endpoint to send to.`, "warn");
      } else if (res.ok) {
        toast(`${labelOf(entry.action)} applied against live state.`);
      } else {
        toast(`Refused (HTTP ${res.status}) — the state it was captured against has moved.`, "warn");
      }
    } catch {
      toast("Could not reach the server — the approval is still waiting.", "warn");
    } finally {
      setBusy(null);
      await load();
    }
  };

  const discard = async (entry: QueuedEntry) => {
    await discardIntent(entry.id);
    toast(`${labelOf(entry.action)} discarded. Nothing was written.`, "warn");
    await load();
  };

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-red-400/30 bg-red-400/[0.06]">
      <div className="border-b border-red-400/20 px-4 py-2.5">
        <div className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em] text-red-500 dark:text-red-400">
          Captured offline · needs your confirmation
        </div>
        <p className="mt-1 text-[10.5px] leading-relaxed text-muted">
          These never replayed on their own. Confirm and the request is made now, against live state.
        </p>
      </div>
      <ul className="divide-y divide-red-400/15">
        {entries.map((entry) => (
          <li key={entry.id} className="px-4 py-3">
            <div className="text-[12px] font-medium">{entry.label ?? labelOf(entry.action)}</div>
            {entry.context && <div className="mt-0.5 text-[10.5px] leading-snug text-muted">{entry.context}</div>}
            <div className="mt-0.5 font-mono text-[10px] text-faint">
              captured {new Date(entry.queuedAt).toLocaleString()}
            </div>
            <div className="mt-2.5 flex gap-2">
              <button
                type="button"
                disabled={!online || busy === entry.id}
                onClick={() => void confirm(entry)}
                className="min-h-[38px] flex-1 rounded-lg bg-brand text-[11.5px] font-semibold text-brand-foreground disabled:opacity-40"
              >
                {busy === entry.id ? "Sending…" : online ? "Confirm now" : "Offline — cannot confirm"}
              </button>
              <button
                type="button"
                disabled={busy === entry.id}
                onClick={() => void discard(entry)}
                className="min-h-[38px] rounded-lg border border-border px-3 text-[11.5px] font-medium text-muted disabled:opacity-40"
              >
                Discard
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
