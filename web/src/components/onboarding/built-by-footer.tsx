"use client";

import Link from "next/link";
import { THIS_BUILD } from "@/lib/site-story.mjs";

/** Persistent, unobtrusive credit line — desktop sidebar footer.
 *  Two separate links (never nested `<a>`s): the sentence opens the credits
 *  page, the builder name itself opens w3jdev.com. */
export function BuiltByFooter() {
  return (
    <div className="px-1 text-[11px] text-faint">
      <Link href="/about" className="transition hover:text-foreground">
        Built by{" "}
      </Link>
      <a
        href={THIS_BUILD.website}
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold text-brand-text hover:underline"
      >
        {THIS_BUILD.builder}
      </a>
    </div>
  );
}
