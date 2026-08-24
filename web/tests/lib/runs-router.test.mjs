// The router decides what a request COSTS before the user consents, so its two
// load-bearing properties are: a free plan is genuinely free (HANDOFF §1
// invariant 4), and every write step is marked gated (§1 invariant 2). A misroute
// costs a declined plan card; a mis-flagged gate would cost an ungated write.
//
// Run:  node --test tests/lib/runs-router.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { GATED_MODES, MODE_COST_USD, classify, extractUrls, isFreePlan, looksLikeJobUrl } from "../../src/lib/runs/router.mjs";

test("scanning, triage and every read are free — the cost-honesty invariant", () => {
  for (const mode of ["scan", "discover", "triage", "tracker", "patterns", "upskill", "prefill"]) {
    assert.equal(MODE_COST_USD[mode], 0, `${mode} must cost nothing`);
  }
});

test("every mode that writes or sends is gated", () => {
  for (const mode of ["pdf", "latex", "cover", "contacto", "email", "apply"]) {
    assert.ok(GATED_MODES.has(mode), `${mode} writes or sends and must be gated`);
  }
  // …and nothing free is gated, or the UI would ask for approval to read.
  for (const mode of ["scan", "triage", "tracker", "patterns"]) {
    assert.ok(!GATED_MODES.has(mode), `${mode} is read-only and must not be gated`);
  }
});

test("a single job posting produces score-then-offer, with both artifacts gated", () => {
  const r = classify({ text: "https://boards.greenhouse.io/anthropic/jobs/4041234" });
  assert.deepEqual(r.chain, ["oferta", "pdf", "apply"]);
  const [score, cv, apply] = r.plan;
  assert.equal(score.gated, false, "scoring writes nothing and must not be gated");
  assert.equal(cv.gated, true);
  assert.equal(apply.gated, true);
  assert.ok(r.estCostUsd > 0);
});

test("an explicit comparison outranks URL shape", () => {
  // Two links plus "compare" is ONE question. Reading it as a board to triage
  // answers something the user did not ask.
  const r = classify({ text: "compare https://jobs.lever.co/a/1 and https://jobs.lever.co/b/2" });
  assert.deepEqual(r.chain, ["ofertas"]);
});

test("a named artifact replaces the default chain tail", () => {
  const r = classify({ text: "draft a cover letter for https://boards.greenhouse.io/x/jobs/999111" });
  assert.deepEqual(r.chain, ["oferta", "cover"]);
  // The posting is still scored first — an artifact with no evaluation behind it
  // would have nothing to tailor against.
  assert.equal(r.chain[0], "oferta");
});

test("a company index is triaged for free, a posting is evaluated", () => {
  assert.equal(looksLikeJobUrl("https://example.com/careers"), false, "a bare index holds no posting");
  assert.equal(looksLikeJobUrl("https://example.com/careers/senior-ai-engineer"), true);
  assert.equal(looksLikeJobUrl("https://acme.com/jobs/"), false, "a trailing slash is still an index");
  assert.deepEqual(classify({ text: "https://example.com/careers" }).chain, ["triage"]);
  assert.ok(isFreePlan(classify({ text: "https://example.com/careers" }).plan));
});

test("known ATS hosts are recognised", () => {
  for (const u of [
    "https://boards.greenhouse.io/anthropic/jobs/4041234",
    "https://jobs.ashbyhq.com/acme/opportunity/abc",
    "https://acme.wd1.myworkdayjobs.com/en-US/careers/job/Lead",
  ]) {
    assert.equal(looksLikeJobUrl(u), true, u);
  }
});

test("intent keywords route to the right mode", () => {
  const cases = [
    ["scan portals for new roles", "scan"],
    ["why am I getting rejected?", "patterns"],
    ["what am I doing wrong?", "patterns"],
    ["prep me for the Retool loop", "prep"],
    ["what should I learn next?", "upskill"],
    ["draft today's follow-ups", "email"],
    ["reach out to the hiring manager", "contacto"],
    ["where do I stand?", "tracker"],
  ];
  for (const [text, mode] of cases) {
    assert.equal(classify({ text }).chain[0], mode, `"${text}" → ${mode}`);
  }
});

test("an unrecognised message falls back to a FREE read, never a spend", () => {
  const r = classify({ text: "hello there" });
  assert.ok(isFreePlan(r.plan), "an unclassified message must not spend tokens by default");
});

test("an attachment with no text is read as a job description", () => {
  const r = classify({ text: "", attachments: [{ name: "jd.pdf" }] });
  assert.deepEqual(r.chain, ["oferta"]);
});

test("empty input produces a free plan rather than throwing", () => {
  for (const input of [{}, { text: "" }, { text: null }, { attachments: null }]) {
    const r = classify(input);
    assert.ok(Array.isArray(r.plan));
    assert.ok(isFreePlan(r.plan));
  }
});

test("the estimate is rounded to cents", () => {
  const r = classify({ text: "https://boards.greenhouse.io/x/jobs/1234" });
  assert.equal(r.estCostUsd, Math.round(r.estCostUsd * 100) / 100);
});

test("URL extraction handles trailing punctuation and multiples", () => {
  assert.deepEqual(extractUrls("see https://a.com/x, and https://b.com/y)"), ["https://a.com/x,", "https://b.com/y"]);
  assert.deepEqual(extractUrls("no links here"), []);
  assert.deepEqual(extractUrls(null), []);
});
