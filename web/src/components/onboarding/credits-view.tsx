"use client";

import { useState } from "react";
import { Code2, Globe, AtSign, Link2, ExternalLink, User } from "lucide-react";
import { instrumentSerif } from "@/lib/fonts";
import { replayOnboarding } from "@/components/onboarding/onboarding-intro";
import { ORIGIN, THIS_BUILD, CREDITS, AGENTS } from "@/lib/site-story.mjs";

/**
 * /about — credits, provenance and the (real, unfabricated) build-duration
 * comparison the user asked for. Every figure here traces to ORIGIN.history
 * or THIS_BUILD in site-story.mjs; nothing is invented for this page.
 */
export function CreditsView() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <h1 className={`${instrumentSerif.className} text-3xl text-foreground`}>Credits & story</h1>
      <p className="mt-2 text-[13.5px] text-muted">
        Who built what, and when — with real numbers, not marketing rounding.
      </p>

      {/* The original engine */}
      <Section title="The original engine">
        <p className="text-[14px] leading-relaxed text-muted">{ORIGIN.story}</p>
        <div className="mt-3 flex flex-wrap gap-2 text-[12px]">
          <Pill>{ORIGIN.stats.jobsEvaluated} jobs evaluated</Pill>
          <Pill>{ORIGIN.stats.cvsGenerated} CVs generated</Pill>
          <Pill>{ORIGIN.stats.outcome}</Pill>
        </div>
        <LinkRow href={ORIGIN.repoUrl} icon={Code2} label={`github.com/${ORIGIN.authorHandle}/career-ops`} />
        <p className="mt-3 text-[12.5px] text-faint">
          Licensed {ORIGIN.license}, authored by {ORIGIN.author}. All credit for the evaluation pipeline, scoring
          model, and the {AGENTS.totalModes} modes it ships goes to the original project.
        </p>
      </Section>

      {/* Build timeline — real numbers only */}
      <Section title="Build timeline">
        <TimelineRow
          label="Original engine"
          value={`${ORIGIN.history.commitCount.toLocaleString()} commits · ${ORIGIN.history.contributorCount} contributors`}
          detail={`${ORIGIN.history.firstCommitDate} → ${ORIGIN.history.asOfCommitDate} (public repo history)`}
        />
        <TimelineRow
          label="This installable app"
          value={`${THIS_BUILD.commitCount} commits`}
          detail={THIS_BUILD.elapsedLabel}
        />
        <p className="mt-3 text-[12px] leading-relaxed text-faint">
          {ORIGIN.history.note} Similarly, "{THIS_BUILD.elapsedLabel}" is calendar time between this fork's first and
          last commit for the web app — not continuous hands-on-keyboard hours. Neither figure is a personal
          time-worked claim; both are what git actually records.
        </p>
      </Section>

      {/* This deployment */}
      <Section title="This deployment">
        <div className="flex items-start gap-3">
          <Avatar />
          <div className="min-w-0">
            <p className="text-[14px] font-semibold text-foreground">
              {CREDITS.name} <span className="font-normal text-faint">· {CREDITS.org}</span>
            </p>
            <p className="text-[12.5px] text-muted">{CREDITS.bio}</p>
            <p className="text-[11.5px] text-faint">{CREDITS.location}</p>
          </div>
        </div>
        <div className="mt-3 space-y-1.5">
          <LinkRow href={CREDITS.githubUrl} icon={Code2} label={`github.com/${CREDITS.handle}`} />
          <LinkRow href={CREDITS.website} icon={Globe} label="w3jdev.com" />
          <LinkRow href={CREDITS.portfolio} icon={Globe} label="portfolio.w3jdev.com" />
          <LinkRow href={CREDITS.twitter} icon={AtSign} label="@mnjewelps" />
          {CREDITS.linkedinUrl ? (
            <LinkRow href={CREDITS.linkedinUrl} icon={Link2} label="LinkedIn" />
          ) : (
            <p className="pl-6 text-[11.5px] text-faint">
              LinkedIn not linked yet — set <code className="rounded bg-surface-hover px-1 py-0.5">NEXT_PUBLIC_CREDITS_LINKEDIN_URL</code> to add it.
            </p>
          )}
        </div>
        <p className="mt-4 text-[13.5px] leading-relaxed text-muted">
          The installable app, offline support, agent run console, approval gates, background workers, push
          notifications, and this production deployment were built with love by{" "}
          <strong className="text-foreground">{THIS_BUILD.builder}</strong> of{" "}
          <a href={THIS_BUILD.website} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-text underline">
            {THIS_BUILD.org}
          </a>
          , on top of {ORIGIN.authorHandle}'s original engine.
        </p>
      </Section>

      <button
        type="button"
        onClick={replayOnboarding}
        className="mt-2 text-[12.5px] text-faint underline underline-offset-2 hover:text-foreground"
      >
        Replay the intro tour
      </button>

      <div className="mt-10 flex items-center justify-center gap-2 border-t border-border pt-6 text-[11.5px] text-faint">
        <span>Built by</span>
        <a
          href={THIS_BUILD.website}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-brand-text hover:underline"
        >
          W3JDEV of W3J LLC
        </a>
      </div>
    </div>
  );
}

/** GitHub avatar with a monogram fallback — same pattern as CompanyLogo, in
 *  case the avatar can't be reached (offline, blocked egress, deleted account). */
function Avatar() {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="flex size-12 shrink-0 items-center justify-center rounded-full border border-border bg-surface-hover text-faint">
        <User className="size-5" />
      </div>
    );
  }
  return (
    <img
      src={`${CREDITS.githubUrl}.png`}
      alt=""
      width={48}
      height={48}
      onError={() => setFailed(true)}
      className="size-12 shrink-0 rounded-full border border-border"
    />
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 rounded-xl border border-border bg-surface/40 p-5">
      <h2 className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md border border-border bg-surface-hover px-2 py-0.5 text-foreground">{children}</span>
  );
}

function TimelineRow({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border/60 py-2.5 last:border-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-medium text-foreground">{label}</span>
        <span className="text-[12.5px] font-semibold text-brand-text">{value}</span>
      </div>
      <span className="text-[11.5px] text-faint">{detail}</span>
    </div>
  );
}

function LinkRow({ href, icon: Icon, label }: { href: string; icon: typeof Code2; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 text-[13px] text-muted transition hover:text-brand-text"
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate">{label}</span>
      <ExternalLink className="size-3 shrink-0 text-faint" />
    </a>
  );
}
