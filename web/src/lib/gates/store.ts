import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { careerOpsRoot } from "@/lib/career-ops";
import { canDecide, gateEvent, isExpired, ledgerHeader, serializeRow } from "@/lib/gates/core.mjs";
import { emit, resume, type RunEvent } from "@/lib/runs/store";

/**
 * store.ts — pending gates and the append-only ledger (HANDOFF.md §5).
 *
 * The flow this implements, verbatim from the handoff:
 *
 *   1. Mode reaches a write/send boundary → server persists a pending gate,
 *      emits `gate`, SUSPENDS the run.
 *   2. UI renders diff + willWrite[] + estimated cost.
 *   3. approve → run resumes, files written, `done` emitted.
 *   4. reject discards; nothing is written. Gates expire in 24h.
 *   5. Gate records are append-only (data/gates.tsv). This is the compliance
 *      surface.
 *
 * The design decision that matters: a gate holds a CONTINUATION, not a
 * pre-computed write. The work is performed on approval, against state as it is
 * at that moment. A gate that carried a finished write and merely flushed it on
 * approve would apply a diff computed up to 24 hours earlier — the same stale-diff
 * hazard the offline queue avoids by storing approvals as intents.
 */

export type GateKind =
  | "cv_diff"
  | "cover_letter"
  | "outreach"
  | "application"
  | "status_change"
  | "profile_edit"
  | "tracker_delete";

export type Gate = {
  id: string;
  runId: string;
  kind: GateKind;
  createdAt: number;
  /** Minted at creation, delivered only on the run's stream. See core.mjs. */
  token: string;
  decision: "pending" | "approved" | "rejected" | "expired";
  /** Rendered by the UI: a unified-ish diff, or any shape the kind implies. */
  diff: unknown;
  /** Every path this gate will touch if approved. The user's consent is to THIS list. */
  willWrite: string[];
  estCostUsd: number;
  /** Free text for the ledger — which company, which role. */
  note?: string;
  /** Performed on approval, never before. */
  apply: () => Promise<{ files?: string[]; note?: string }>;
};

const pending = new Map<string, Gate>();

function ledgerPath(): string {
  return path.join(careerOpsRoot(), "data", "gates.tsv");
}

function appendLedger(gate: Gate, decision: Gate["decision"], note?: string): void {
  try {
    const file = ledgerPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Header only on creation, so the file is self-describing without a
    // migration for anyone who already has one.
    if (!fs.existsSync(file)) fs.writeFileSync(file, ledgerHeader() + "\n", "utf8");
    fs.appendFileSync(
      file,
      serializeRow({
        gateId: gate.id,
        at: Date.now(),
        runId: gate.runId,
        kind: gate.kind,
        decision,
        actor: "local",
        estCostUsd: gate.estCostUsd,
        willWrite: gate.willWrite,
        note: note ?? gate.note,
      }) + "\n",
      "utf8",
    );
  } catch {
    // A gate must not be blocked by a ledger write failure — refusing the
    // approval would be a worse outcome than an incomplete audit trail, and the
    // run's own jsonl still records the decision.
  }
}

/**
 * Open a gate: persist it, emit the `gate` event, and leave the run suspended.
 * Returns the gate so the caller can await the decision.
 */
export function openGate(args: {
  runId: string;
  kind: GateKind;
  diff?: unknown;
  willWrite: string[];
  estCostUsd?: number;
  note?: string;
  apply: () => Promise<{ files?: string[]; note?: string }>;
}): Gate {
  const gate: Gate = {
    id: `g_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
    runId: args.runId,
    kind: args.kind,
    createdAt: Date.now(),
    // 32 bytes: this is the only thing standing between a cross-origin caller
    // that guessed a gate id and a file write.
    token: randomBytes(32).toString("base64url"),
    decision: "pending",
    diff: args.diff ?? null,
    willWrite: args.willWrite,
    estCostUsd: args.estCostUsd ?? 0,
    note: args.note,
    apply: args.apply,
  };
  pending.set(gate.id, gate);
  appendLedger(gate, "pending");
  // Emitting the gate is what suspends the run — see runs/store.ts emit().
  emit(args.runId, gateEvent(gate) as unknown as RunEvent);
  return gate;
}

export function getGate(id: string): Gate | null {
  const gate = pending.get(id) ?? null;
  if (gate && gate.decision === "pending" && isExpired(gate)) {
    // Lazily reap on read rather than on a timer: a gate nobody looks at again
    // costs nothing, and a timer in a long-lived Next process is one more thing
    // that can fire after a restart against state that has moved.
    gate.decision = "expired";
    appendLedger(gate, "expired", "expired unapproved after 24h");
    emit(gate.runId, { type: "error", code: "gate_expired", message: "The gate expired before it was decided. Nothing was written.", retryable: true });
  }
  return gate;
}

/** Pending gates, newest first — for the Apply surface and the decision queue. */
export function listPending(): Array<Omit<Gate, "apply" | "token">> {
  return [...pending.values()]
    .filter((g) => g.decision === "pending" && !isExpired(g))
    // The token is never included here: this listing is reachable without having
    // seen the diff, which is precisely the case the token exists to refuse.
    .map(({ apply: _apply, token: _token, ...rest }) => rest)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export type DecisionResult = { ok: true; files: string[] } | { ok: false; status: number; reason: string };

/**
 * Approve: run the continuation, record the outcome, resume the run.
 *
 * If the continuation throws, the gate is NOT marked approved — it is left
 * decided-with-failure and the run errors. Recording an approval for a write
 * that did not happen would make the ledger lie in the one direction that
 * matters.
 */
export async function approveGate(id: string, token: string): Promise<DecisionResult> {
  const gate = getGate(id);
  const check = canDecide(gate, token);
  if (!check.ok) return { ok: false, status: check.status, reason: check.reason };
  const g = gate as Gate;

  // Claim it before the await, so two concurrent approvals cannot both run the
  // continuation and write the files twice.
  g.decision = "approved";

  let files: string[] = [];
  try {
    const out = await g.apply();
    files = out.files ?? [];
    appendLedger(g, "approved", out.note);
    resume(g.runId);
    emit(g.runId, { type: "artifact", kind: "mutation_receipt", data: { gateId: g.id, files }, files });
    emit(g.runId, { type: "done", ms: Date.now() - g.createdAt, costUsd: g.estCostUsd, files });
    pending.delete(id);
    return { ok: true, files };
  } catch (e) {
    const message = e instanceof Error ? e.message : "the approved write failed";
    appendLedger(g, "rejected", `approved but the write failed: ${message}`);
    resume(g.runId);
    emit(g.runId, { type: "error", code: "gate_apply_failed", message, retryable: true });
    pending.delete(id);
    return { ok: false, status: 500, reason: message };
  }
}

/** Reject: nothing is written, and the ledger says so. */
export async function rejectGate(id: string, token: string, note?: string): Promise<DecisionResult> {
  const gate = getGate(id);
  const check = canDecide(gate, token);
  if (!check.ok) return { ok: false, status: check.status, reason: check.reason };
  const g = gate as Gate;
  g.decision = "rejected";
  appendLedger(g, "rejected", note ?? "discarded by the user");
  resume(g.runId);
  emit(g.runId, { type: "done", ms: Date.now() - g.createdAt, costUsd: 0, files: [] });
  pending.delete(id);
  return { ok: true, files: [] };
}
