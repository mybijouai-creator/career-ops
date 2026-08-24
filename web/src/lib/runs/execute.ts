import { resolveCli } from "@/lib/clis";
import { careerOpsRoot } from "@/lib/career-ops";
import { accumulateTokens } from "@/lib/run-cli-support.mjs";
import { spawnHeadlessCli } from "@/lib/spawn-cli.mjs";
import { claudeCliArgs } from "@/lib/claude-invocation.mjs";
import { emit } from "@/lib/runs/store";

/**
 * execute.ts — run one step of a plan through the user's own agent CLI, reporting
 * into the run store as it goes.
 *
 * The web ORCHESTRATES the career-ops engine; it does not reimplement it. Same
 * principle as /api/run: a step spawns the real CLI against the real modes, so a
 * run from the web produces byte-identical artifacts to one from the terminal.
 * What this adds over /api/run is that progress lands on the §4 event stream
 * instead of a bespoke per-route protocol, which is what lets the console render
 * one component per event and lets a worker and a user-initiated run share a
 * code path.
 *
 * It never writes files itself. Whatever the mode writes, the mode writes; the
 * gate is what decides whether that mode is allowed to run at all.
 */

export type StepResult = { ok: true; text: string; tokens: number } | { ok: false; error: string };

/** Hard ceiling per step, so a hung CLI cannot hold a run open forever. */
const STEP_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Execute one step.
 *
 * @param runId    the run to report into
 * @param i        the step's index in the plan (the §4 `step` event's `i`)
 * @param mode     mode name, for the label
 * @param label    human text for the checklist row
 * @param prompt   the full prompt handed to the CLI
 * @param cliId    which CLI to use; falls back to whatever is installed
 */
export async function executeStep(args: {
  runId: string;
  i: number;
  mode: string;
  label: string;
  prompt: string;
  cliId?: string | null;
}): Promise<StepResult> {
  const { runId, i, mode, label, prompt } = args;
  const started = Date.now();

  const resolved = args.cliId ? resolveCli(args.cliId) : null;
  if (!resolved) {
    const error = args.cliId
      ? `The CLI "${args.cliId}" is not installed here.`
      : "No agent CLI is configured. Pick one in Settings — the web app drives your CLI, it does not embed a model.";
    emit(runId, { type: "step", i, state: "failed", label, ms: 0, costUsd: 0 });
    emit(runId, { type: "error", code: "no_cli", message: error, retryable: false });
    return { ok: false, error };
  }

  emit(runId, { type: "step", i, state: "running", label, ms: 0, costUsd: 0 });

  const { spec, binPath } = resolved;
  const isClaude = spec.id === "claude";
  // Claude gets the tool-restricted invocation the repo already defines; other
  // CLIs get their own documented streaming argv.
  const argv = isClaude ? claudeCliArgs({ kind: mode, prompt }) : (spec.streamArgs ?? spec.args)(prompt);

  return await new Promise<StepResult>((resolve) => {
    let child;
    try {
      child = spawnHeadlessCli(binPath, argv, { cwd: careerOpsRoot(), env: process.env });
    } catch (e) {
      const error = e instanceof Error ? e.message : "could not start the CLI";
      emit(runId, { type: "step", i, state: "failed", label, ms: Date.now() - started, costUsd: 0 });
      emit(runId, { type: "error", code: "spawn_failed", message: error, retryable: true });
      resolve({ ok: false, error });
      return;
    }

    let text = "";
    let stderr = "";
    let tokens = 0;
    let settled = false;

    const finish = (result: StepResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* already gone */
      }
      const error = `${mode} exceeded ${Math.round(STEP_TIMEOUT_MS / 60000)} minutes and was stopped.`;
      emit(runId, { type: "step", i, state: "failed", label, ms: Date.now() - started, costUsd: 0 });
      emit(runId, { type: "error", code: "timeout", message: error, retryable: true });
      finish({ ok: false, error });
    }, STEP_TIMEOUT_MS);

    // Line-buffered: a CLI's stream is ndjson and a chunk boundary can land
    // mid-line, so a naive per-chunk parse drops events at random.
    let buffer = "";
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        if (!spec.parseEvent) {
          text += line + "\n";
          continue;
        }
        const ev = spec.parseEvent(line);
        if (!ev) continue;
        if (ev.text) text += ev.text;
        const before = tokens;
        tokens = accumulateTokens(tokens, ev);
        if (tokens !== before) {
          // Real accounting, from the CLI's own reporting — never the estimate.
          // HANDOFF §1 invariant 3: every run is priced.
          emit(runId, { type: "usage", tokensIn: 0, tokensOut: tokens - before, costUsd: 0 });
        }
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 20_000) stderr = stderr.slice(-20_000);
    });

    child.on("error", (e) => {
      emit(runId, { type: "step", i, state: "failed", label, ms: Date.now() - started, costUsd: 0 });
      emit(runId, { type: "error", code: "cli_error", message: e.message, retryable: true });
      finish({ ok: false, error: e.message });
    });

    child.on("close", (code) => {
      const ms = Date.now() - started;
      if (code === 0) {
        emit(runId, { type: "step", i, state: "done", label, ms, costUsd: 0 });
        finish({ ok: true, text: text.trim(), tokens });
        return;
      }
      // The CLI's own last words are far more useful than "exit 1".
      const error = stderr.trim().split("\n").filter(Boolean).pop() || `${mode} exited with code ${code}`;
      emit(runId, { type: "step", i, state: "failed", label, ms, costUsd: 0 });
      emit(runId, { type: "error", code: "cli_exit", message: error, retryable: true });
      finish({ ok: false, error });
    });
  });
}
