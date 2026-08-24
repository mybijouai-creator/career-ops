/**
 * core.mjs — the gate protocol's pure half (HANDOFF.md §5).
 *
 * A gate is the point where a mode reaches a write-or-send boundary, stops, and
 * asks a human. HANDOFF §1 invariant 2 is what this file exists to make true:
 *
 *   "Human-in-the-loop is a policy layer, not a setting. […] There is no toggle
 *    to disable this."
 *
 * So there is no bypass parameter here, no `force`, and no "trusted" caller. The
 * only way past a gate is a decision recorded in the ledger.
 *
 * Serialization, expiry and decision validation live here — pure, so
 * `node --test` can assert the ledger format and the expiry boundary without a
 * filesystem or a running server.
 */

/** Gate lifecycle. `expired` is a real outcome, not an error: §5 step 4. */
export const DECISIONS = ["pending", "approved", "rejected", "expired"];

/** What a gate can be asking about. Mirrors the gated modes in runs/router.mjs. */
export const GATE_KINDS = ["cv_diff", "cover_letter", "outreach", "application", "status_change", "profile_edit", "tracker_delete"];

/** §5 step 4: "Gates expire in 24h." */
export const GATE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * The append-only ledger's columns. Same discipline as status-log.tsv
 * (DATA_CONTRACT.md): never edited in place — a decision appends a SECOND row
 * rather than rewriting the pending one, so the ledger records the whole
 * lifecycle and a decision cannot be quietly changed after the fact. That is
 * what makes this "the compliance surface" rather than a status field.
 */
export const GATE_COLUMNS = [
  "gate_id",
  "at",
  "run_id",
  "kind",
  "decision",
  "actor",
  "est_cost_usd",
  "will_write",
  "note",
];

/** An empty cell is ambiguous in a TSV, so absent values are this sentinel. */
const EMPTY = "-";

/** Tabs and newlines would break the row; nothing else is altered. */
function cell(value) {
  if (value === null || value === undefined || value === "") return EMPTY;
  return String(value).replace(/[\t\r\n]+/g, " ").trim() || EMPTY;
}

/**
 * One ledger row. `willWrite` is joined with a comma because the column is a
 * LIST and a TSV cannot nest — readers split on comma.
 */
export function serializeRow({ gateId, at, runId, kind, decision, actor, estCostUsd, willWrite, note }) {
  if (!DECISIONS.includes(decision)) throw new Error(`unknown gate decision "${decision}"`);
  return [
    cell(gateId),
    cell(new Date(at ?? Date.now()).toISOString()),
    cell(runId),
    cell(kind),
    cell(decision),
    // Without authentication there is no identity to record. `local` is the
    // honest value: someone with access to this machine decided. When a real
    // session exists this becomes the account, and the ledger's shape does not
    // have to change.
    cell(actor || "local"),
    cell(typeof estCostUsd === "number" ? estCostUsd.toFixed(4) : estCostUsd),
    cell(Array.isArray(willWrite) ? willWrite.join(",") : willWrite),
    cell(note),
  ].join("\t");
}

/** Parse a ledger row back. Tolerates short rows from an older writer. */
export function parseRow(line) {
  if (typeof line !== "string" || !line.trim() || line.startsWith("#")) return null;
  const parts = line.split("\t");
  const get = (i) => {
    const v = parts[i];
    return v === undefined || v === EMPTY ? null : v;
  };
  const decision = get(4);
  if (!decision) return null;
  return {
    gateId: get(0),
    at: get(1),
    runId: get(2),
    kind: get(3),
    decision,
    actor: get(5),
    estCostUsd: get(6) === null ? null : Number(get(6)),
    willWrite: get(7) ? get(7).split(",").filter(Boolean) : [],
    note: get(8),
  };
}

export function ledgerHeader() {
  return `# ${GATE_COLUMNS.join("\t")}`;
}

/** Has this gate outlived its 24h window? */
export function isExpired(gate, now = Date.now()) {
  // Number.isFinite, not `typeof === "number"`: NaN is a number, and
  // `now - NaN > TTL` is FALSE, so a gate with a corrupt timestamp would have
  // been permanently approvable. This check has to fail closed.
  if (!gate || !Number.isFinite(gate.createdAt)) return true;
  return now - gate.createdAt > GATE_TTL_MS;
}

/**
 * Can this gate be decided right now, with this token?
 *
 * The token check is deliberately not "authentication" and must not be read as
 * such. There is no login in this app; the token is minted when the gate opens
 * and delivered only on the stream the browser is already holding, so
 * possessing it proves the caller is the client that was SHOWN the diff. That
 * closes blind approval — a request that never saw what it was approving — and
 * together with the same-origin guard it is the strongest binding available
 * without a session. It is not proof of WHO decided, which is exactly why the
 * ledger's actor column records `local` rather than a name it cannot know.
 *
 * @returns {{ok: true} | {ok: false, status: number, reason: string}}
 */
export function canDecide(gate, token, now = Date.now()) {
  if (!gate) return { ok: false, status: 404, reason: "no such gate" };
  if (gate.decision && gate.decision !== "pending") {
    return { ok: false, status: 409, reason: `this gate was already ${gate.decision}` };
  }
  if (isExpired(gate, now)) {
    return { ok: false, status: 410, reason: "this gate expired — re-run to get a fresh diff against current state" };
  }
  if (!token || token !== gate.token) {
    return { ok: false, status: 403, reason: "missing or wrong gate token — approve from the client that opened the gate" };
  }
  return { ok: true };
}

/**
 * The payload the UI needs to render a gate, per §5 step 2: the diff, the file
 * list, and the cost. The TOKEN is included, because the client has to send it
 * back — and it only ever travels on the stream that client already holds.
 */
export function gateEvent(gate) {
  return {
    type: "gate",
    gateId: gate.id,
    kind: gate.kind,
    diff: gate.diff ?? null,
    willWrite: gate.willWrite ?? [],
    estCostUsd: gate.estCostUsd ?? 0,
    expiresAt: gate.createdAt + GATE_TTL_MS,
    token: gate.token,
  };
}
