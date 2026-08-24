"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { useRun } from "@/lib/runs/use-run";
import { RunConsole } from "@/components/runs/run-console";
import { useToast } from "@/components/mobile/toast";
import { resolveCliId } from "@/lib/saved-cli";

/**
 * PrepRunner — builds a loop plan for one tracked role through the real prep
 * mode, streaming into the shared RunConsole.
 *
 * This is what replaced the page's CLI-invocation handoff. The document it
 * produces lands in interview-prep/, which is the user's own layer, so the run is
 * NOT gated: it writes working notes rather than an outward-facing artifact, and
 * it sends nothing. It does spend, so the cost is shown before it starts.
 */
export function PrepRunner({ roleId, company }: { roleId: string; company: string }) {
  const { state, attach, decideGate } = useRun();
  const [starting, setStarting] = useState(false);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  const start = async () => {
    setStarting(true);
    try {
      // Resolved at click time, not on mount: the user may have picked a CLI in
      // Settings since this page rendered.
      const cliId = await resolveCliId();
      const res = await fetch(`/api/prep/${encodeURIComponent(roleId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliId }),
      });
      const body = (await res.json().catch(() => ({}))) as { runId?: string; error?: string };
      if (!res.ok || !body.runId) {
        toast(body.error ?? "Could not start the prep run.", "warn");
        return;
      }
      void attach(body.runId);
    } catch {
      toast("Could not reach the server.", "warn");
    } finally {
      setStarting(false);
    }
  };

  const decide = async (decision: "approve" | "reject") => {
    setBusy(true);
    const r = await decideGate(decision);
    setBusy(false);
    if (!r.ok) toast(r.error ?? "The gate refused that.", "warn");
  };

  const running = state.status === "streaming" || state.status === "gated";

  return (
    <div className="mt-3 space-y-3">
      {state.status === "idle" && (
        <button
          type="button"
          onClick={() => void start()}
          disabled={starting}
          className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl bg-brand text-[12.5px] font-semibold text-brand-foreground disabled:opacity-50"
        >
          <Sparkles className="size-4" aria-hidden />
          {starting ? "Starting…" : `Build the ${company} loop plan`}
        </button>
      )}
      <RunConsole state={state} onDecide={decide} busy={busy} />
      {running && (
        <p className="text-center text-[10.5px] text-faint">
          Writing into interview-prep/ — your story bank is added to, never rewritten.
        </p>
      )}
    </div>
  );
}
