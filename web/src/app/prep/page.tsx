import Link from "next/link";
import { FileText, Mic, Terminal } from "lucide-react";
import { readInterviewPrep, readApplications } from "@/lib/career-ops";
import { instrumentSerif } from "@/lib/fonts";
import { CopyableCommand } from "@/components/copyable-command";
import { PrepRunner } from "@/components/prep/prep-runner";

// The Interviews route from the PWA prototype ("loop plans, story bank, gaps").
//
// WIRED: the document listing is real — it reads the user's own
// `interview-prep/` (user layer, gitignored, never written from here) and the
// companies currently at Interview in the tracker.
//
// NOT WIRED, and said so on the page rather than mocked: generating a loop plan,
// drilling a round and dictating a story are core MODES with no HTTP route yet
// (HANDOFF §2 lists `POST /api/prep/:roleId`; it does not exist). Rather than
// render a plausible five-round plan with invented interviewer names, the page
// hands over the CLI invocation that does the real thing.
export const dynamic = "force-dynamic";

export const metadata = { title: "Interviews — career-ops" };

export default function PrepPage() {
  const { docs, sessions } = readInterviewPrep();
  const interviewing = readApplications().filter((a) => /^interview/i.test(a.status));

  return (
    <div className="co-surface mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <header>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">
          <span className="text-faint">//</span> interviews
        </p>
        <h1 className={`${instrumentSerif.className} mt-2 text-3xl leading-tight text-landing`}>
          Loop plans, story bank, gaps
        </h1>
      </header>

      {/* ── In-progress loops: real tracker rows ──────────────────────────── */}
      <section className="mt-7">
        <h2 className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.1em] text-faint">
          In an interview loop · {interviewing.length}
        </h2>
        {interviewing.length === 0 ? (
          <p className="mt-2.5 rounded-xl border border-dashed border-border px-4 py-6 text-center text-[11.5px] leading-relaxed text-faint">
            Nothing at the Interview stage. Rows move here when you advance them from the pipeline.
          </p>
        ) : (
          <ul className="mt-2.5 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
            {interviewing.map((a) => (
              <li key={a.n} className="px-4 py-3">
                <Link href={`/jobs/${a.n}`} className="flex min-h-[36px] items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold">{a.company}</div>
                    <div className="truncate text-[11px] text-faint">{a.role}</div>
                  </div>
                  <span className="shrink-0 font-mono text-[11px] text-muted">{a.score}</span>
                </Link>
                {/* The real prep mode, streaming — this is what POST
                    /api/prep/:roleId replaced the CLI handoff with. */}
                <PrepRunner roleId={a.n} company={a.company} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Prep documents on disk: real listing ──────────────────────────── */}
      <section className="mt-7">
        <h2 className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.1em] text-faint">
          Prep documents · interview-prep/
          {sessions > 0 && <span className="ml-1.5 normal-case text-muted">{sessions} logged sessions</span>}
        </h2>
        {docs.length === 0 ? (
          <p className="mt-2.5 rounded-xl border border-dashed border-border px-4 py-6 text-center text-[11.5px] leading-relaxed text-faint">
            No prep documents yet. The story bank is built up from real interviews — it is yours, and nothing here
            writes to it.
          </p>
        ) : (
          <ul className="mt-2.5 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
            {docs.map((d) => (
              <li key={d.file} className="flex min-h-[56px] items-center gap-3 px-4 py-3">
                <FileText className="size-4 shrink-0 text-faint" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium">
                    {d.storyBank ? "Story bank" : d.company ? `${d.company} · ${d.title}` : d.title}
                  </div>
                  <div className="truncate font-mono text-[10.5px] text-faint">{d.file}</div>
                </div>
                <span className="shrink-0 font-mono text-[10px] text-faint">{d.modified}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── The honest boundary ───────────────────────────────────────────── */}
      <section className="mt-7 rounded-xl border border-border bg-surface p-4">
        <div className="flex items-center gap-2">
          <Terminal className="size-4 shrink-0 text-brand" aria-hidden />
          <h2 className="text-[13px] font-semibold">Or run it from your terminal</h2>
        </div>
        <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
          Building a loop plan now runs from here — the button on each role above drives your own CLI and streams the
          result. These are the same modes from a terminal, plus the ones this surface does not wrap yet: drilling a
          round and shaping a dictated story.
        </p>
        <div className="mt-3 space-y-2">
          <CopyableCommand command={'claude -p "Run career-ops interview-prep"'} />
          <CopyableCommand command={'claude -p "Run career-ops interview/practice"'} />
        </div>
        <p className="mt-2.5 text-[10.5px] leading-relaxed text-faint">
          Any supported CLI works — swap <span className="font-mono">claude -p</span> for{" "}
          <span className="font-mono">codex exec</span>, <span className="font-mono">opencode run</span> or your own,
          or type <span className="font-mono">/career-ops interview-prep</span> interactively. You can also just ask
          on the <Link href="/agent" className="text-brand-text underline decoration-dotted">Agent</Link> tab.
        </p>
        <p className="mt-3 flex items-start gap-1.5 text-[10.5px] leading-relaxed text-faint">
          <Mic className="mt-px size-3 shrink-0" aria-hidden />
          Dictated stories are shaped into STAR+R by the mode, and any quantified claim has to trace back to{" "}
          <span className="font-mono">cv.md</span> before it counts as a fact.
        </p>
      </section>
    </div>
  );
}
