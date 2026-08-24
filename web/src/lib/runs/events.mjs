/**
 * events.mjs — the streaming contract from HANDOFF.md §4.
 *
 * `GET /api/runs/:runId/stream` emits newline-delimited JSON. The console renders
 * ONE component per event type, and `artifact.kind` is the switch the frontend
 * dispatches on:
 *
 *   "The frontend switches on `kind` — this enum is the gen-UI contract. Adding a
 *    component means adding a `kind`, not a new page."
 *
 * That is why the enum lives here as a value rather than a TypeScript type: the
 * server validates against it before emitting, so a typo'd kind fails loudly at
 * the emit site instead of silently rendering nothing in the client's default
 * branch. `node --test` asserts it against the handoff's own list.
 */

export const EVENT_TYPES = ["plan", "step", "artifact", "gate", "usage", "done", "error"];

/** The gen-UI contract. Adding a component means adding a member here. */
export const ARTIFACT_KINDS = [
  "score_card",
  "comparison",
  "triage_list",
  "cv_diff",
  "prefill",
  "outreach_drafts",
  "prep_plan",
  "funnel",
  "mutation_receipt",
];

/** Step lifecycle, per the §4 table. */
export const STEP_STATES = ["running", "done", "failed"];

/**
 * Validate an event before it is written to a stream.
 *
 * Strict on purpose. An unknown event type or artifact kind reaches the client
 * as a silent no-op — the switch falls through and the user sees a run that
 * produced nothing — so the failure belongs here, at the emit site, where the
 * stack trace names the caller.
 *
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function validateEvent(event) {
  if (!event || typeof event !== "object") return { ok: false, reason: "event must be an object" };
  const { type } = event;
  if (!EVENT_TYPES.includes(type)) {
    return { ok: false, reason: `unknown event type "${type}" (expected one of ${EVENT_TYPES.join(", ")})` };
  }
  if (type === "artifact") {
    if (!ARTIFACT_KINDS.includes(event.kind)) {
      return { ok: false, reason: `unknown artifact kind "${event.kind}" — add it to ARTIFACT_KINDS and give the client a component` };
    }
  }
  if (type === "step") {
    if (!STEP_STATES.includes(event.state)) {
      return { ok: false, reason: `unknown step state "${event.state}"` };
    }
    if (!Number.isInteger(event.i) || event.i < 0) {
      return { ok: false, reason: "step.i must be a non-negative integer" };
    }
  }
  if (type === "gate" && !event.gateId) {
    return { ok: false, reason: "a gate event without a gateId cannot be approved" };
  }
  return { ok: true };
}

/** One newline-delimited JSON frame. */
export function encodeEvent(event) {
  return JSON.stringify(event) + "\n";
}

/**
 * Which events END a run. The stream closes after one of these, and the store
 * stops accepting appends — so a late `step` from a stray timer cannot reopen a
 * finished run and leave the UI spinning forever.
 */
export const TERMINAL_TYPES = ["done", "error"];

export function isTerminal(event) {
  return !!event && TERMINAL_TYPES.includes(event.type);
}
