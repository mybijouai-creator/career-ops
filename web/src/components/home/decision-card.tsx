"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X, FileText, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { CompanyLogo } from "@/components/company-logo";
import { scoreNum, scoreTone } from "@/lib/format";
import type { Application } from "@/lib/career-ops";
import { usePwa } from "@/components/pwa/pwa-provider";
import { useToast } from "@/components/mobile/toast";
import { useSheet } from "@/components/mobile/sheet";

// Awaiting-decision row: a scored role with no terminal status. Primary action
// opens the report (PDF + Apply live there). Skip / Applied still write status.
export function DecisionCard({ app }: { app: Application }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"" | "Applied" | "Discarded">("");
  const [done, setDone] = useState<string | null>(null);
  const score = scoreNum(app.score);
  const tone = scoreTone(app.score);
  const { mutate } = usePwa();
  const { toast } = useToast();
  const sheet = useSheet();

  // Queued offline and replayed on reconnect — see status-select.tsx for why a
  // status advance is safe to replay unattended.
  const setStatus = async (status: "Applied" | "Discarded") => {
    setBusy(status);
    try {
      const out = await mutate("status-advance", { target: app.n, payload: { n: app.n, status } });
      if (out.kind === "queued") {
        toast(`Queued · ${app.company} → ${status} on reconnect.`, "queued");
      } else if (out.kind === "unavailable") {
        toast(out.reason, "warn");
        return;
      }
      // The card leaves the queue either way: the decision has been made and
      // recorded, and re-showing it would invite a second tap on the same row.
      setDone(status);
      router.refresh();
    } catch {
      /* ignore */
    } finally {
      setBusy("");
    }
  };

  if (done) return null;

  const whySheet = {
    title: `${app.company} — why ${app.score}`,
    meta: `#${app.n}`,
    body: app.notes?.trim()
      ? app.notes
      : "This row carries no notes. The full evaluation — blocks A–H, the comp research and the tool trace — is in the report.",
    // The report path IS the provenance: the markdown file is the source of
    // truth, and the app holds no separate copy of it.
    file: app.report ? stripLink(app.report) : undefined,
    primaryLabel: "Open the evaluation",
    onPrimary: () => router.push(`/pipeline/${app.n}`),
  };

  return (
    <div className="flex min-w-0 flex-col gap-2.5 rounded-xl border border-border bg-surface/40 p-3.5 transition hover:border-brand/30">
      <div className="flex items-start gap-2.5">
        <CompanyLogo name={app.company} size={24} />
        {/* Below md the identity block opens the "why this score" sheet: on a
            phone this is a glance before a one-tap decision, and making it a
            route means a back navigation to get out of a glance. The Review
            button below stays the explicit path on both breakpoints.

            Two elements rather than one with `pointer-events-none`, because the
            sheet only renders below md — a button that swallows a desktop click
            and shows nothing is worse than not being a button there at all. */}
        <button
          type="button"
          onClick={() => sheet.open(whySheet)}
          className="min-w-0 flex-1 text-left md:hidden"
        >
          <Identity company={app.company} role={app.role} />
        </button>
        <div className="hidden min-w-0 flex-1 md:block">
          <Identity company={app.company} role={app.role} />
        </div>
        {Number.isFinite(score) && score > 0 && (
          <span
            className={cn(
              "shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums",
              tone === "good" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : tone === "warn" ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" : "bg-surface-hover text-muted",
            )}
          >
            {app.score}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {/* Primary is the report (PDF + Apply live there). Marking Applied from
            Today skipped that path and wrote a status with no application. */}
        <a
          href={`/pipeline/${app.n}`}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-brand-soft px-2.5 py-1.5 text-xs font-medium text-brand-text transition hover:bg-brand/15 max-sm:min-h-[44px]"
        >
          <FileText className="size-3.5" /> Review
        </a>
        <button
          type="button"
          disabled={!!busy}
          onClick={() => setStatus("Discarded")}
          className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted transition hover:text-foreground disabled:opacity-60 max-sm:min-h-[44px] max-sm:px-4"
        >
          {busy === "Discarded" ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />} Skip
        </button>
        <button
          type="button"
          disabled={!!busy}
          onClick={() => setStatus("Applied")}
          title="Record Applied without opening the apply flow"
          className="inline-flex shrink-0 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-faint transition hover:text-foreground disabled:opacity-60 max-sm:min-h-[44px]"
        >
          {busy === "Applied" ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          Applied
        </button>
      </div>
    </div>
  );
}

function Identity({ company, role }: { company: string; role: string }) {
  return (
    <>
      <p className="truncate text-sm font-medium text-foreground">{company}</p>
      <p className="truncate text-[13px] text-muted">{role}</p>
    </>
  );
}

/** The tracker's report cell is a markdown link (`[64](../reports/…md)`); the
 *  sheet wants the bare path, which is what identifies the file on disk. */
function stripLink(cell: string): string {
  const m = cell.match(/\(([^)]+)\)/);
  return (m ? m[1] : cell).replace(/^\.\.\//, "");
}
