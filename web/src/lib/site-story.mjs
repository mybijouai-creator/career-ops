/**
 * site-story.mjs — the one place the app's onboarding tour, the /about page,
 * and the sidebar/settings credit line all pull from.
 *
 * Every number in here is either counted from a file in this repo at the time
 * this module was written, or read from the public santifer/career-ops
 * GitHub history and this fork's own commit log. Nothing is estimated or
 * guessed — where a real figure isn't published (santifer's personal hours,
 * for instance), the field says so explicitly rather than filling the gap.
 * Follows the project's own no-fabrication rule (AGENTS.md, Source-of-Truth
 * Boundary) by analogy: this module is marketing copy, not user data, but the
 * same discipline applies — a made-up number here would be exactly the kind
 * of manufactured detail that rule exists to prevent.
 */

/** The original, upstream open-source project this app is built on top of. */
export const ORIGIN = {
  project: "career-ops",
  author: "Santiago Fernández de Valderrama",
  authorHandle: "santifer",
  repoUrl: "https://github.com/santifer/career-ops",
  license: "MIT",
  story:
    "Built by one engineer who spent months applying to jobs the slow way, " +
    "then engineered the system he wished he'd had. He used it himself to " +
    "evaluate 740+ job listings, generate 100+ tailored CVs, and land a " +
    "Head of Applied AI role — then open-sourced the whole pipeline under " +
    "the MIT license so anyone could run their own search the same way.",
  // Counted from the public repo's git history (santifer/career-ops, shallow
  // history unshallowed for this count) at the time this fork was branched.
  // A commit-history span is a real, verifiable number — but it is the
  // project's public development window, not one person's hours worked, and
  // 326 people besides santifer have committed to it since release.
  history: {
    firstCommitDate: "2026-04-04",
    asOfCommitDate: "2026-08-23",
    commitCount: 1526,
    contributorCount: 326,
    releaseTagCount: 37,
    note:
      "This is the repo's public commit history span (first commit to the " +
      "commit this fork branched from) — not santifer's personal build time, " +
      "which he hasn't published. Treat it as project age, not effort.",
  },
  stats: {
    jobsEvaluated: "740+",
    cvsGenerated: "100+",
    outcome: "1 dream role landed (Head of Applied AI)",
  },
};

/**
 * How many modes ("agents") the system actually has, and how many of them
 * this web app currently drives end-to-end versus leaves to the CLI.
 *
 * Counted directly from modes/*.md (excluding modes/README.md and the
 * per-language variants under modes/{de,fr,ar,...}/) and from
 * src/lib/runs/router.mjs's MODE_COST_USD table, which is the definitive
 * list of modes the intent router can currently dispatch to a live run.
 */
export const AGENTS = {
  totalModes: 34,
  wiredModes: 16,
  note:
    "34 specialized modes ship in the CLI (scan, evaluate, tailor a CV, draft " +
    "outreach, prep for an interview, and more). This app wires 16 of them " +
    "into one-tap runs with a plan-and-approve step before anything is " +
    "written or sent; the rest stay reachable by running career-ops directly " +
    "in a terminal.",
  groups: [
    { label: "Discover", modes: ["scan", "discover", "triage", "titles"] },
    { label: "Evaluate", modes: ["oferta", "ofertas", "patterns", "upskill"] },
    { label: "Apply", modes: ["pdf", "latex", "cover", "email", "contacto", "apply"] },
    { label: "Prep", modes: ["prep", "interview"] },
    { label: "Track", modes: ["tracker", "followup", "outcome"] },
  ],
};

/**
 * This deployment's own build timeline — the PWA layer, the backend wiring
 * (intent router, run stream, approval gates, workers, push), and the
 * production Docker/Coolify pipeline added on top of the original project.
 *
 * Pulled from this fork's own git log (`git log --format=%ad -1/--reverse`
 * over the commits that added web/), not from a stopwatch — it's elapsed
 * calendar time across one engagement, including any gaps for review and
 * back-and-forth, not continuous hands-on-keyboard hours.
 */
export const THIS_BUILD = {
  builder: "W3JDEV",
  org: "W3J LLC",
  githubHandle: "W3JDev",
  githubUrl: "https://github.com/W3JDev",
  website: "https://w3jdev.com",
  firstCommitAt: "2026-08-23T12:31:56Z",
  lastCommitAt: "2026-08-24T08:13:16Z",
  commitCount: 9,
  elapsedLabel: "~20 hours elapsed (single engagement, 9 commits)",
  scope:
    "Installable PWA shell (offline reads, replay queue, install prompt), the " +
    "SSE run stream and approval-gate protocol, background workers, Web " +
    "Push, and the production Docker image + Coolify deployment pipeline.",
};

/** Real, public profile data for the person/org behind this deployment. */
export const CREDITS = {
  name: "MN Jewel",
  handle: "W3JDev",
  org: "w3j LLC",
  bio:
    "AI Engineer & DeFi Degen. 11+ years building for business. Son who used " +
    "AI to help his mom fight cancer.",
  location: "Malaysia",
  githubUrl: "https://github.com/W3JDev",
  website: "https://w3jdev.com",
  portfolio: "https://portfolio.w3jdev.com",
  twitter: "https://x.com/mnjewelps",
  // Not fabricated: no LinkedIn URL was provided. Set NEXT_PUBLIC_CREDITS_LINKEDIN_URL
  // in the deployment environment to add one — the /about page only renders
  // this row when it's non-empty.
  linkedinUrl: typeof process !== "undefined" ? process.env.NEXT_PUBLIC_CREDITS_LINKEDIN_URL || "" : "",
};
