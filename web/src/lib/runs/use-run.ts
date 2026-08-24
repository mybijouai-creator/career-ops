"use client";

import { useCallback, useRef, useState } from "react";

/**
 * use-run.ts — the client half of the §4 stream.
 *
 * Reads the ndjson run stream and keeps the pieces the UI actually renders: the
 * plan, per-step state, artifacts, the open gate, and the running total. One
 * hook rather than per-surface fetch code, so every surface that starts a run —
 * the agent console, Interviews, a worker card — renders the same components off
 * the same events, which is what the gen-UI contract is for.
 */

export type RunStep = { i: number; label: string; state: "running" | "done" | "failed"; ms?: number };
export type RunArtifact = { kind: string; data: unknown; files?: string[] };
export type RunGate = { gateId: string; kind: string; diff: unknown; willWrite: string[]; estCostUsd: number; token: string; expiresAt: number };

export type RunState = {
  runId: string | null;
  status: "idle" | "streaming" | "gated" | "done" | "failed";
  plan: Array<{ mode: string; label: string; estCostUsd: number; gated: boolean }>;
  steps: RunStep[];
  artifacts: RunArtifact[];
  gate: RunGate | null;
  tokensOut: number;
  costUsd: number;
  files: string[];
  error: string | null;
};

const EMPTY: RunState = {
  runId: null,
  status: "idle",
  plan: [],
  steps: [],
  artifacts: [],
  gate: null,
  tokensOut: 0,
  costUsd: 0,
  files: [],
  error: null,
};

export function useRun() {
  const [state, setState] = useState<RunState>(EMPTY);
  // Aborts the in-flight stream when a new run starts or the component unmounts,
  // so an abandoned run does not keep a reader alive and keep calling setState.
  const abort = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abort.current?.abort();
    abort.current = null;
    setState(EMPTY);
  }, []);

  const attach = useCallback(async (runId: string) => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setState({ ...EMPTY, runId, status: "streaming" });

    let res: Response;
    try {
      res = await fetch(`/api/runs/${encodeURIComponent(runId)}/stream`, { signal: controller.signal });
    } catch {
      setState((s) => ({ ...s, status: "failed", error: "could not open the run stream" }));
      return;
    }
    if (!res.ok || !res.body) {
      setState((s) => ({ ...s, status: "failed", error: `the run stream returned ${res.status}` }));
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    // Line-buffered: a chunk boundary lands mid-line often enough that a naive
    // per-chunk JSON.parse silently drops events.
    let buffer = "";

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let ev: Record<string, unknown>;
          try {
            ev = JSON.parse(line);
          } catch {
            continue;
          }
          setState((s) => reduce(s, ev));
        }
      }
    } catch {
      // An aborted read is the normal teardown path, not an error worth showing.
      if (!controller.signal.aborted) {
        setState((s) => ({ ...s, status: "failed", error: "the run stream ended unexpectedly" }));
      }
    }
  }, []);

  /** Start a run from free text (or a URL) and follow it. */
  const send = useCallback(
    async (text: string) => {
      const res = await fetch("/api/agent/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setState((s) => ({ ...s, status: "failed", error: d.error ?? "the router refused that" }));
        return null;
      }
      const d = (await res.json()) as { runId: string };
      void attach(d.runId);
      return d.runId;
    },
    [attach],
  );

  /** Decide the open gate. The token came in on the stream — see gates/core.mjs. */
  const decideGate = useCallback(
    async (decision: "approve" | "reject") => {
      const gate = state.gate;
      if (!gate) return { ok: false, error: "no open gate" };
      const res = await fetch(`/api/gates/${encodeURIComponent(gate.gateId)}/${decision}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Gate-Token": gate.token },
        body: JSON.stringify({ token: gate.token }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; files?: string[] };
      if (!res.ok) return { ok: false, error: body.error ?? `the gate returned ${res.status}` };
      // The run's own `done` event arrives on the stream, so state is not patched
      // here — the server remains the single source of truth for run state.
      return { ok: true, files: body.files ?? [] };
    },
    [state.gate],
  );

  return { state, send, attach, reset, decideGate };
}

function reduce(s: RunState, ev: Record<string, unknown>): RunState {
  switch (ev.type) {
    case "plan":
      return { ...s, plan: (ev.steps as RunState["plan"]) ?? [], status: "streaming" };
    case "step": {
      const step: RunStep = {
        i: Number(ev.i),
        label: String(ev.label ?? ""),
        state: ev.state as RunStep["state"],
        ms: typeof ev.ms === "number" ? ev.ms : undefined,
      };
      // Replace by index rather than append: a step reports running then done,
      // and appending would render the same row twice.
      const steps = s.steps.filter((x) => x.i !== step.i).concat(step).sort((a, b) => a.i - b.i);
      return { ...s, steps, status: "streaming" };
    }
    case "artifact":
      return {
        ...s,
        artifacts: s.artifacts.concat({ kind: String(ev.kind), data: ev.data, files: (ev.files as string[]) ?? [] }),
      };
    case "gate":
      return { ...s, gate: ev as unknown as RunGate, status: "gated" };
    case "usage":
      return {
        ...s,
        tokensOut: s.tokensOut + (Number(ev.tokensOut) || 0),
        costUsd: s.costUsd + (Number(ev.costUsd) || 0),
      };
    case "done":
      return {
        ...s,
        status: "done",
        gate: null,
        files: s.files.concat((ev.files as string[]) ?? []),
        costUsd: s.costUsd + (Number(ev.costUsd) || 0),
      };
    case "error":
      return { ...s, status: "failed", gate: null, error: String(ev.message ?? "the run failed") };
    default:
      return s;
  }
}
