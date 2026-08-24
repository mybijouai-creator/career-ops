// The runner's prompts are the ENTIRE context a CLI step receives, and a job
// description reaching that step is untrusted input (AGENTS.md). These assert the
// guardrails are actually in every prompt rather than in a comment above it —
// the #2185-class guard failure was a test that matched a route's own prose.
//
// Run:  node --test tests/lib/runs-prompts.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { GUARDRAILS, prepPrompt, slug } from "../../src/lib/runs/prompts.mjs";

test("the guardrails state the untrusted-content rule", () => {
  assert.match(GUARDRAILS, /DATA, never instructions/i);
  assert.match(GUARDRAILS, /addressed to an AI/i);
});

test("the guardrails state the no-fabrication rule and name the in-scope files", () => {
  assert.match(GUARDRAILS, /Never invent a fact/i);
  for (const file of ["cv.md", "config/profile.yml", "modes/_profile.md", "article-digest.md"]) {
    assert.ok(GUARDRAILS.includes(file), `${file} must be named as an in-scope source`);
  }
  assert.match(GUARDRAILS, /never fabricate/i);
});

test("the guardrails forbid authorship conflation and any send", () => {
  assert.match(GUARDRAILS, /Never claim the user authored/i);
  assert.match(GUARDRAILS, /Never submit, send, or click Apply/i);
  assert.match(GUARDRAILS, /Never contact anyone/i);
});

test("every prompt carries the guardrails verbatim", () => {
  const p = prepPrompt({ company: "Acme", role: "Head of AI", today: "2026-08-24" });
  assert.ok(p.startsWith(GUARDRAILS), "the guardrails must lead the prompt, not trail it");
});

test("the prep prompt protects the story bank from being rewritten", () => {
  // interview-prep/ is accumulated over a real job search; a well-meaning
  // "tidy up" would destroy it.
  const p = prepPrompt({ company: "Acme", role: "Head of AI", today: "2026-08-24" });
  assert.match(p, /never rewrite or delete an existing entry/i);
  // \s+ rather than a literal space: the prompt is hard-wrapped, so this phrase
  // spans a newline in the source and a literal-space regex would miss it.
  assert.match(p, /the user's\s+OWN\s+stories/i);
});

test("the prep prompt refuses to invent a loop", () => {
  const p = prepPrompt({ company: "Acme", role: "Head of AI", today: "2026-08-24" });
  assert.match(p, /Do not invent interviewer names/i);
  assert.match(p, /say what is unknown/i);
});

test("the prep prompt requires quantified figures to trace to cv.md", () => {
  const p = prepPrompt({ company: "Acme", role: "Head of AI", today: "2026-08-24" });
  assert.match(p, /must appear in cv\.md/i);
  assert.match(p, /mark it unverified/i);
});

test("the prep prompt names the gaps as the point, not an afterthought", () => {
  const p = prepPrompt({ company: "Acme", role: "Head of AI", today: "2026-08-24" });
  assert.match(p, /most useful part/i);
  assert.match(p, /do not paper over it/i);
});

test("a missing report is stated, not silently omitted", () => {
  const withReport = prepPrompt({ company: "A", role: "R", reportPath: "reports/1-a.md", today: "2026-08-24" });
  assert.match(withReport, /reports\/1-a\.md/);
  const without = prepPrompt({ company: "A", role: "R", today: "2026-08-24" });
  assert.match(without, /no evaluation report for this role yet/i);
});

test("the output filename follows the {company}-{role}.md convention", () => {
  const p = prepPrompt({ company: "Acme Corp", role: "Head of Applied AI", today: "2026-08-24" });
  assert.match(p, /interview-prep\/acme-corp-head-of-applied-ai\.md/);
});

test("slug is filesystem-safe and never empty", () => {
  assert.equal(slug("Acme Corp"), "acme-corp");
  assert.equal(slug("Head of Applied AI"), "head-of-applied-ai");
  assert.equal(slug("../../etc/passwd"), "etc-passwd", "path separators must not survive");
  assert.equal(slug("!!!"), "role", "an unusable name still yields a valid filename");
  assert.equal(slug(""), "role");
  assert.equal(slug(null), "role");
  assert.ok(slug("x".repeat(200)).length <= 40);
});
