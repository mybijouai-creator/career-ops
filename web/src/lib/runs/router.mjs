/**
 * router.mjs — what replaces the CLI's mode names (HANDOFF.md §3).
 *
 * `POST /api/agent/intent` takes free text, a URL or a file drop and returns an
 * ordered mode chain BEFORE anything executes, so the UI can price the run and
 * the user can decline it. That ordering is the whole point: a router that
 * executes first and reports after cannot be refused.
 *
 * Pure and side-effect free — no fs, no fetch, no LLM. Classification is
 * deliberately keyword-and-shape based rather than a model call: routing is on
 * the path of every single request, and spending tokens to decide whether to
 * spend tokens is both slow and absurd. A misroute costs one wrong plan card
 * that the user declines; it never costs a wrong write, because every write in
 * the chain is gated.
 *
 * Lives in .mjs so `node --test` can assert the table directly.
 */

/**
 * Estimated cost per mode, in USD.
 *
 * These are ESTIMATES for the plan card, not measurements. The real figure is
 * recorded per run from the CLI's own token accounting and is what the ledger
 * and the KPI strip report — see HANDOFF §8. They are here so the user sees a
 * number before consenting, and they are deliberately rounded up: a plan that
 * under-promises and over-charges is worse than one that over-promises.
 *
 * `0` is a claim, not a placeholder: scanning, triage and every read are
 * structurally free because they call no model at all (HANDOFF §1 invariant 4).
 */
export const MODE_COST_USD = {
  scan: 0,
  discover: 0,
  triage: 0,
  tracker: 0,
  patterns: 0,
  upskill: 0,
  prefill: 0,
  oferta: 0.05,
  ofertas: 0.03,
  pdf: 0.03,
  latex: 0.03,
  cover: 0.02,
  contacto: 0.01,
  email: 0.01,
  prep: 0.03,
  interview: 0.03,
};

/**
 * Modes that reach a write/send boundary and therefore SUSPEND at a gate
 * (HANDOFF §5). Not a cost question — `contacto` is cheap and still gated,
 * because it drafts something addressed to a real person.
 *
 * `apply` is in here and is the important one: it prepares an application and
 * stops. There is no mode that submits, in this table or in the codebase.
 */
export const GATED_MODES = new Set(["pdf", "latex", "cover", "contacto", "email", "apply", "outcome", "status"]);

/** Human label per mode, for the plan card. */
const MODE_LABEL = {
  scan: "Scan portals — zero tokens",
  discover: "Discover new boards — zero tokens",
  triage: "Triage without scoring — zero tokens",
  oferta: "Score blocks A–H",
  ofertas: "Compare and rank",
  pdf: "Tailor the CV",
  latex: "Tailor the LaTeX CV",
  cover: "Draft a cover letter",
  apply: "Prepare the application",
  contacto: "Draft outreach",
  email: "Draft the follow-up",
  prep: "Build the interview loop plan",
  interview: "Drill a round",
  patterns: "Analyse outcomes",
  upskill: "Map the skill gaps",
  tracker: "Read the tracker",
  prefill: "Prefill the ATS form",
};

/** Extract every http(s) URL in the text. */
export function extractUrls(text) {
  if (typeof text !== "string") return [];
  return text.match(/https?:\/\/[^\s<>"')]+/g) ?? [];
}

/**
 * Does this URL look like a single job posting rather than a company home page?
 * Only used to choose between evaluating one role and triaging a board — a wrong
 * answer costs a declined plan card, never a write.
 */
export function looksLikeJobUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const s = `${u.hostname}${u.pathname}`.toLowerCase();
  // A known ATS with a posting-shaped path, or any URL that says "job".
  if (/(greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|icims\.com|smartrecruiters\.com|workable\.com|teamtailor\.com|recruitee\.com|personio\.de)/.test(s)) {
    return /\/(jobs?|postings?|opportunit(y|ies)|careers?)\//.test(s) || /\/\d{4,}/.test(s);
  }
  // A job-ish segment must be FOLLOWED by something — a slug or an id. Bare
  // `/careers` is a company index, and routing it to an evaluation would spend
  // tokens on a page that holds no posting; the free triage path exists for
  // exactly that, and requiring the tail is what keeps it reachable.
  return /\/(jobs?|careers?|vacanc(y|ies)|positions?|openings?|stellen?|offres?|puestos?)\/[^/]/.test(s);
}

const RULES = [
  // Ordered most-specific first: the first match wins, so "compare these two
  // job links" must be read as a comparison and not as two separate evals.
  { re: /\b(compare|versus|vs\.?|which (is|one)|rank(ing)?|shortlist)\b/i, chain: ["ofertas"] },
  { re: /\b(scan|search|find|hunt|look for|any new)\b.*\b(roles?|jobs?|postings?|offers?|portals?)\b/i, chain: ["scan"] },
  { re: /\b(triage|first pass|quick filter|worth (a look|evaluating))\b/i, chain: ["triage"] },
  // No trailing \b on this one: the alternation ends at "reject" and the real
  // input is "rejected", where a word boundary does not exist.
  { re: /\b(why (am i|do i)\b.*\breject|pattern|rejection|what am i doing wrong)/i, chain: ["patterns"] },
  { re: /\b(what should i learn|skill gap|upskill|missing skills?)\b/i, chain: ["upskill"] },
  { re: /\b(prep|prepare) me\b|\b(interview|loop) (plan|prep)\b|\bdrill\b/i, chain: ["prep"] },
  { re: /\b(cover letter|motivation letter|lettre de motivation)\b/i, chain: ["cover"] },
  { re: /\b(outreach|reach out|contact|hiring manager|recruiter|linkedin (dm|message))\b/i, chain: ["contacto"] },
  { re: /\b(follow[ -]?ups?|nudge|chase|check in with)\b/i, chain: ["email"] },
  { re: /\b(tailor|rewrite|adapt).*\b(cv|resume|résumé)\b|\b(cv|resume) for\b/i, chain: ["pdf"] },
  { re: /\b(apply|application|prefill|fill (in|out) the form)\b/i, chain: ["apply"] },
  { re: /\b(status|pipeline|tracker|where (am i|do i stand))\b/i, chain: ["tracker"] },
];

/**
 * Classify an intent into a plan.
 *
 * @param {{text?: string, attachments?: Array<{name?: string, kind?: string}>}} input
 * @returns {{chain: string[], plan: Array<{mode: string, label: string, estCostUsd: number, gated: boolean}>, estCostUsd: number, urls: string[], reason: string}}
 */
export function classify(input = {}) {
  const text = typeof input.text === "string" ? input.text : "";
  const attachments = Array.isArray(input.attachments) ? input.attachments : [];
  const urls = extractUrls(text);
  const jobUrls = urls.filter(looksLikeJobUrl);

  const hit = RULES.find((r) => r.re.test(text));
  // What the text explicitly ASKS for, when it names an artifact. This is what
  // lets "draft a cover letter for <url>" produce oferta → cover instead of the
  // default oferta → pdf → apply: the posting still has to be scored first, but
  // the artifact is the one that was requested.
  const askedArtifact = hit && ["pdf", "latex", "cover", "contacto", "email", "apply"].includes(hit.chain[0])
    ? hit.chain[0]
    : null;

  let chain;
  let reason;

  // An explicit comparison outranks URL shape. Two links plus the word "compare"
  // is one question, and reading it as a board to triage — which is what the URL
  // heuristic alone did — answers something the user did not ask.
  if (hit?.chain[0] === "ofertas") {
    chain = ["ofertas"];
    reason = urls.length > 1 ? `${urls.length} postings — ranked against each other` : "a comparison across your shortlist";
  } else if (jobUrls.length > 1) {
    // Several postings at once: compare rather than evaluating each in turn,
    // which is both cheaper and the question the user is actually asking.
    chain = ["ofertas"];
    reason = `${jobUrls.length} postings — ranked against each other`;
  } else if (jobUrls.length === 1) {
    // The canonical flow from HANDOFF §3's own example: score it, then offer the
    // artifacts. Every artifact step is gated, so accepting the plan still writes
    // nothing — the gate is where a human decides.
    chain = askedArtifact ? ["oferta", askedArtifact] : ["oferta", "pdf", "apply"];
    reason = askedArtifact
      ? `a single posting — score it, then ${MODE_LABEL[askedArtifact].toLowerCase()}`
      : "a single posting — score it, then offer the CV and the application";
  } else if (attachments.length > 0) {
    // A dropped file is a JD until proven otherwise; scoring it is the useful
    // default and the user can decline the plan.
    chain = ["oferta"];
    reason = `${attachments.length} attachment(s) read as a job description`;
  } else if (urls.length > 0) {
    // A URL that is not posting-shaped: a board or a company page. Triage it for
    // free rather than spending an evaluation on something that may hold none.
    chain = ["triage"];
    reason = "a board or company page — triaged for free";
  } else {
    chain = hit ? hit.chain : ["tracker"];
    reason = hit ? "matched an intent" : "no specific intent — answered from the tracker";
  }

  const plan = chain.map((mode) => ({
    mode,
    label: MODE_LABEL[mode] ?? mode,
    estCostUsd: MODE_COST_USD[mode] ?? 0,
    gated: GATED_MODES.has(mode),
  }));

  return {
    chain,
    plan,
    // Rounded to cents: a plan card promising $0.0834 implies a precision the
    // estimate does not have.
    estCostUsd: Math.round(plan.reduce((n, s) => n + s.estCostUsd, 0) * 100) / 100,
    urls,
    reason,
  };
}

/** True when the whole plan is free — the UI says so instead of showing $0.00. */
export function isFreePlan(plan) {
  return Array.isArray(plan) && plan.every((s) => !s.estCostUsd);
}
