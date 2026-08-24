"use client";

import { Check, Loader2, X, AlertTriangle, FileText } from "lucide-react";
import type { RunState } from "@/lib/runs/use-run";

/**
 * RunConsole — one component per event type, per HANDOFF.md §4's table.
 *
 * The gate is the only blocking element. Everything else is advisory: the run
 * continues whether or not the user is looking at it, which is why steps and
 * artifacts render as history rather than as prompts.
 *
 * Artifacts dispatch on `kind`. An unrecognised kind renders as a labelled raw
 * block instead of nothing — a new server-side kind reaching an older client
 * should look unstyled, not invisible, because invisible reads as "the run
 * produced nothing".
 */
export function RunConsole({
  state,
  onDecide,
  busy,
}: {
  state: RunState;
  onDecide?: (decision: "approve" | "reject") => void;
  busy?: boolean;
}) {
  if (state.status === "idle") return null;

  return (
    <div className="flex flex-col gap-3">
      {state.plan.length > 0 && (
        <div className="rounded-xl border border-border bg-surface p-3">
          <div className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.1em] text-faint">Plan</div>
          <ul className="mt-2 space-y-1.5">
            {state.plan.map((p, i) => {
              const step = state.steps.find((s) => s.i === i);
              return (
                <li key={`${p.mode}-${i}`} className="flex items-center gap-2 text-[12px]">
                  <StepIcon state={step?.state} />
                  <span className={step?.state === "done" ? "text-muted" : ""}>{p.label}</span>
                  {p.gated && (
                    <span className="rounded px-1.5 py-0.5 text-[9px] font-semibold text-brand-text ring-1 ring-brand/30">
                      needs approval
                    </span>
                  )}
                  <span className="ml-auto font-mono text-[10px] text-faint">
                    {step?.ms ? `${(step.ms / 1000).toFixed(1)}s` : p.estCostUsd ? `~$${p.estCostUsd.toFixed(2)}` : "free"}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {state.artifacts.map((a, i) => (
        <Artifact key={`${a.kind}-${i}`} kind={a.kind} data={a.data} files={a.files} />
      ))}

      {state.gate && (
        <div className="overflow-hidden rounded-xl border border-brand/35 bg-brand-soft">
          <div className="border-b border-brand/20 px-3 py-2.5">
            <div className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em] text-brand-text">
              Approval gate
            </div>
            <p className="mt-0.5 text-[10.5px] text-muted">
              {state.gate.willWrite.length} file{state.gate.willWrite.length === 1 ? "" : "s"} will be written · nothing
              is submitted
            </p>
          </div>
          <div className="px-3 py-3">
            {state.gate.diff != null && (
              <pre className="max-h-56 overflow-auto rounded-lg border border-border bg-background p-2.5 font-mono text-[10.5px] leading-relaxed">
                {typeof state.gate.diff === "string" ? state.gate.diff : JSON.stringify(state.gate.diff, null, 2)}
              </pre>
            )}
            <div className="mt-2.5 rounded-lg border border-border bg-background p-2.5">
              <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.08em] text-faint">Will write</div>
              <ul className="mt-1.5 space-y-0.5 font-mono text-[10.5px] text-muted">
                {state.gate.willWrite.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
            <div className="mt-3 flex flex-col gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => onDecide?.("approve")}
                className="min-h-[46px] rounded-xl bg-brand text-[13px] font-semibold text-brand-foreground disabled:opacity-50"
              >
                {busy ? "Writing…" : "Approve & write files"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => onDecide?.("reject")}
                className="min-h-[44px] rounded-xl border border-border text-[12px] font-medium text-muted disabled:opacity-50"
              >
                Discard — write nothing
              </button>
            </div>
            <p className="mt-2 text-center font-mono text-[10px] text-faint">
              est. ${state.gate.estCostUsd.toFixed(2)} · expires{" "}
              {new Date(state.gate.expiresAt).toLocaleString()}
            </p>
          </div>
        </div>
      )}

      {state.error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-400/30 bg-red-400/[0.07] px-3 py-2.5">
          <AlertTriangle className="mt-px size-4 shrink-0 text-red-500 dark:text-red-400" aria-hidden />
          <p className="text-[11.5px] leading-relaxed text-muted">{state.error}</p>
        </div>
      )}

      {(state.tokensOut > 0 || state.files.length > 0 || state.status === "done") && (
        <div className="flex items-center gap-2 px-1 font-mono text-[10px] text-faint">
          {state.status === "done" && <span className="text-emerald-500 dark:text-emerald-400">done</span>}
          {state.tokensOut > 0 && <span>{state.tokensOut.toLocaleString()} tokens</span>}
          {state.files.length > 0 && (
            <span className="ml-auto flex items-center gap-1">
              <FileText className="size-3" aria-hidden />
              {state.files.length} file{state.files.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function StepIcon({ state }: { state?: "running" | "done" | "failed" }) {
  if (state === "done") return <Check className="size-3.5 shrink-0 text-emerald-500 dark:text-emerald-400" aria-hidden />;
  if (state === "failed") return <X className="size-3.5 shrink-0 text-red-500 dark:text-red-400" aria-hidden />;
  if (state === "running") return <Loader2 className="size-3.5 shrink-0 animate-spin text-brand" aria-hidden />;
  return <span aria-hidden className="size-3.5 shrink-0 rounded-full border border-border" />;
}

const ARTIFACT_TITLE: Record<string, string> = {
  score_card: "Score",
  comparison: "Comparison",
  triage_list: "Triage",
  cv_diff: "CV diff",
  prefill: "ATS prefill",
  outreach_drafts: "Outreach drafts",
  prep_plan: "Loop plan",
  funnel: "Funnel",
  mutation_receipt: "Files written",
};

function Artifact({ kind, data, files }: { kind: string; data: unknown; files?: string[] }) {
  const title = ARTIFACT_TITLE[kind] ?? kind;
  const summary =
    data && typeof data === "object" && "summary" in data && typeof (data as { summary: unknown }).summary === "string"
      ? (data as { summary: string }).summary
      : null;

  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em] text-brand-text">{title}</span>
        {!ARTIFACT_TITLE[kind] && (
          // An unknown kind is shown as unstyled rather than dropped: invisible
          // reads as "the run produced nothing", which is the wrong story.
          <span className="font-mono text-[9px] text-faint">unrecognised kind — shown raw</span>
        )}
      </div>
      {summary ? (
        <p className="mt-1.5 whitespace-pre-wrap text-[12px] leading-relaxed text-muted">{summary}</p>
      ) : (
        <pre className="mt-1.5 max-h-56 overflow-auto font-mono text-[10.5px] leading-relaxed text-muted">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
      {files && files.length > 0 && (
        <ul className="mt-2 space-y-0.5 font-mono text-[10px] text-faint">
          {files.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
