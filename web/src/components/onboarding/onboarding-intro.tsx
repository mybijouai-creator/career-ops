"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Compass, ListChecks, Send, GraduationCap, Heart, X } from "lucide-react";
import { CoMark } from "@/components/co-mark";
import { instrumentSerif } from "@/lib/fonts";
import { AGENTS, ORIGIN, THIS_BUILD } from "@/lib/site-story.mjs";

const STORAGE_KEY = "career-ops:onboarding-seen-v1";

/**
 * First-time-visitor tour: a handful of full-screen slides shown once before
 * the dashboard, then never again unless replayed from /about or Settings.
 *
 * Gated by localStorage rather than a server flag on purpose — this is a
 * per-browser courtesy, not application state, and it must never block
 * rendering while a network round-trip resolves (localStorage read is
 * synchronous and happens after mount, so the dashboard is never hidden
 * behind a loading spinner for returning visitors).
 */
export function OnboardingIntro() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setOpen(true);
    } catch {
      /* localStorage unavailable (private mode, blocked storage) — skip the
         tour rather than throw; it is a courtesy, not a requirement. */
    }
  }, []);

  const dismiss = () => {
    setOpen(false);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  if (!open) return null;

  const last = step === SLIDES.length - 1;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-background">
      <button
        type="button"
        onClick={dismiss}
        aria-label="Skip intro"
        className="absolute right-4 top-4 z-10 flex size-9 items-center justify-center rounded-full text-faint transition hover:bg-surface-hover hover:text-foreground [padding-top:env(safe-area-inset-top)]"
      >
        <X className="size-4" />
      </button>

      <div className="flex flex-1 items-center justify-center overflow-y-auto px-6 py-16">
        <div className="w-full max-w-lg">{SLIDES[step].render()}</div>
      </div>

      <div className="flex shrink-0 flex-col items-center gap-4 px-6 pb-[calc(env(safe-area-inset-bottom)+24px)]">
        <div className="flex items-center gap-1.5">
          {SLIDES.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${i === step ? "w-5 bg-brand" : "w-1.5 bg-border"}`}
            />
          ))}
        </div>
        <div className="flex w-full max-w-lg gap-2.5">
          {step > 0 && (
            <button
              type="button"
              onClick={() => setStep((s) => s - 1)}
              className="rounded-md border border-border px-4 py-2.5 text-sm font-medium text-muted transition hover:text-foreground"
            >
              Back
            </button>
          )}
          <button
            type="button"
            onClick={() => (last ? dismiss() : setStep((s) => s + 1))}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
          >
            {last ? "Go to dashboard" : "Next"}
            {!last && <ArrowRight className="size-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Reopen the tour on demand (Settings / /about "Replay intro" link). */
export function replayOnboarding() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  window.location.href = "/";
}

const GROUP_ICON = { Discover: Compass, Evaluate: ListChecks, Apply: Send, Prep: GraduationCap, Track: ListChecks };

const SLIDES = [
  {
    render: () => (
      <div className="text-center">
        <CoMark size={56} />
        <h1 className={`${instrumentSerif.className} mt-6 text-4xl text-foreground`}>Welcome to career-ops</h1>
        <p className="mt-4 text-[15px] leading-relaxed text-muted">
          An AI job-search pipeline that scores openings the way a good recruiter would, tailors your CV and cover
          letter to each one, drafts your outreach, and preps you for the interview — all from your own CV and a job
          posting. Nothing is ever sent or submitted without you reviewing it first.
        </p>
      </div>
    ),
  },
  {
    render: () => (
      <div className="text-center">
        <h2 className={`${instrumentSerif.className} text-3xl text-foreground`}>
          {AGENTS.totalModes} specialized modes
        </h2>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">{AGENTS.note}</p>
        <div className="mt-6 grid grid-cols-2 gap-2.5 text-left sm:grid-cols-3">
          {AGENTS.groups.map((g) => {
            const Icon = GROUP_ICON[g.label as keyof typeof GROUP_ICON] ?? Compass;
            return (
              <div key={g.label} className="rounded-lg border border-border bg-surface/40 p-3">
                <Icon className="size-4 text-brand-text" />
                <p className="mt-2 text-[13px] font-semibold text-foreground">{g.label}</p>
                <p className="mt-0.5 text-[11.5px] text-faint">{g.modes.join(" · ")}</p>
              </div>
            );
          })}
        </div>
      </div>
    ),
  },
  {
    render: () => (
      <div>
        <h2 className={`${instrumentSerif.className} text-3xl text-foreground`}>Where this started</h2>
        <p className="mt-4 text-[15px] leading-relaxed text-muted">{ORIGIN.story}</p>
        <div className="mt-4 flex flex-wrap gap-2 text-[12px]">
          <Stat label="Jobs evaluated" value={ORIGIN.stats.jobsEvaluated} />
          <Stat label="CVs generated" value={ORIGIN.stats.cvsGenerated} />
          <Stat label="Outcome" value={ORIGIN.stats.outcome} />
        </div>
        <p className="mt-4 text-[13px] text-faint">
          Open-sourced under the {ORIGIN.license} license as{" "}
          <a href={ORIGIN.repoUrl} target="_blank" rel="noopener noreferrer" className="text-brand-text underline">
            {ORIGIN.authorHandle}/career-ops
          </a>{" "}
          — {ORIGIN.history.contributorCount} contributors and counting. All credit for the pipeline you're about to
          use goes to {ORIGIN.author}.
        </p>
      </div>
    ),
  },
  {
    render: () => (
      <div className="text-center">
        <Heart className="mx-auto size-8 text-brand-text" />
        <h2 className={`${instrumentSerif.className} mt-4 text-3xl text-foreground`}>This installable app</h2>
        <p className="mt-4 text-[15px] leading-relaxed text-muted">
          The app you're about to open — the installable PWA, offline support, one-tap agent runs, and this
          deployment — was built with love by{" "}
          <a href={THIS_BUILD.githubUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-text underline">
            {THIS_BUILD.builder}
          </a>{" "}
          of{" "}
          <a href={THIS_BUILD.website} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-text underline">
            {THIS_BUILD.org}
          </a>{" "}
          on top of {ORIGIN.authorHandle}'s original engine.
        </p>
        <Link href="/about" className="mt-5 inline-block text-[13px] text-faint underline underline-offset-2">
          See the full credits & build story →
        </Link>
      </div>
    ),
  },
];

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-md border border-border bg-surface-hover px-2.5 py-1 text-foreground">
      <span className="font-semibold">{value}</span> <span className="text-faint">{label}</span>
    </span>
  );
}
