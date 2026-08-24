import Link from "next/link";
import { CloudOff } from "lucide-react";
import { instrumentSerif } from "@/lib/fonts";

// The service worker's navigation fallback (precached at install). Reached only
// when the network is down AND this particular route has never been cached, so
// it has to be useful without any data: name the state, and point at the
// surfaces that ARE readable offline.
//
// Static on purpose — a `force-dynamic` page cannot be precached, which would
// defeat the one job this page has.
export const dynamic = "force-static";

export const metadata = { title: "Offline — career-ops" };

const READABLE = [
  { href: "/", label: "Today", note: "your decision queue, as of the last sync" },
  { href: "/pipeline", label: "Pipeline", note: "every tracked application" },
  { href: "/jobs", label: "Evaluations", note: "cached reports, blocks A–H" },
];

export default function OfflinePage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <div className="flex items-center gap-2.5 text-amber-600 dark:text-amber-400">
        <CloudOff className="size-5" aria-hidden />
        <span className="font-mono text-xs uppercase tracking-[0.2em]">offline</span>
      </div>
      <h1 className={`${instrumentSerif.className} mt-3 text-3xl leading-tight text-landing`}>
        Nothing cached for this route yet.
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        career-ops is local-first, so everything you have already opened stays readable. This particular screen has
        not been visited since the app was installed, so there is no copy of it to show.
      </p>

      <ul className="mt-7 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
        {READABLE.map(({ href, label, note }) => (
          <li key={href}>
            <Link href={href} className="flex min-h-[52px] items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-hover">
              <span className="text-sm font-medium">{label}</span>
              <span className="ml-auto text-right text-[11px] text-faint">{note}</span>
            </Link>
          </li>
        ))}
      </ul>

      <p className="mt-6 text-[11.5px] leading-relaxed text-faint">
        Anything you change while offline queues locally and replays when you reconnect. Approvals are the exception:
        they are never replayed unattended — you are asked again, against live state.
      </p>
    </div>
  );
}
