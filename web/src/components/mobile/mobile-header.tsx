"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { ChevronLeft, Settings, Circle } from "lucide-react";
import { CoMark } from "@/components/co-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { routeMeta } from "@/lib/mobile-routes.mjs";
import { usePwa } from "@/components/pwa/pwa-provider";

/**
 * The mobile header from the prototype: back chevron (only where there is
 * somewhere to go back to), the surface's title and one line of orientation,
 * and a settings affordance.
 *
 * Back prefers real history and falls back to the route's declared parent, which
 * is the case that matters in the installed app: opened from a notification
 * straight onto `/apply/…`, the history stack is empty and `router.back()` would
 * leave the user staring at the same screen.
 */
export function MobileHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { online } = usePwa();
  const meta = routeMeta(pathname);

  const goBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    if (meta.parent) router.push(meta.parent);
  };

  return (
    <header className="co-mheader sticky top-0 z-30 border-b border-border bg-background md:hidden">
      <div className="flex items-center gap-2.5 px-3 pb-2.5">
        {meta.parent ? (
          <button
            type="button"
            onClick={goBack}
            aria-label="Back"
            className="inline-flex size-[34px] shrink-0 items-center justify-center rounded-[10px] border border-border bg-surface text-foreground"
          >
            <ChevronLeft className="size-4" aria-hidden />
          </button>
        ) : (
          <Link href="/" aria-label="career-ops home" className="inline-flex size-[34px] shrink-0 items-center justify-center">
            <CoMark size={26} />
          </Link>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h1 className="truncate text-[16px] font-semibold tracking-[-0.01em]">{meta.title}</h1>
            {!online && (
              <Circle
                className="size-2 shrink-0 fill-amber-400 text-amber-400"
                aria-label="Offline — showing cached data"
              />
            )}
          </div>
          {meta.subtitle && <p className="truncate font-mono text-[10.5px] text-faint">{meta.subtitle}</p>}
        </div>

        <ThemeToggle />
        <Link
          href="/config"
          aria-label="Settings"
          className="inline-flex size-[34px] shrink-0 items-center justify-center rounded-[10px] border border-brand/30 bg-brand-soft text-brand-text"
        >
          <Settings className="size-4" aria-hidden />
        </Link>
      </div>
    </header>
  );
}
