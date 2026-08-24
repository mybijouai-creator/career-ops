"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Compass, Sparkles, ListChecks, BarChart3 } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { cn } from "@/lib/cn";
import { MOBILE_TABS, activeTab } from "@/lib/mobile-routes.mjs";
import { useDecisionCount } from "@/components/mobile/decision-count";

/**
 * The bottom tab bar — the ONLY global navigation on mobile, replacing the
 * slide-over drawer. Five items, per the prototype's mobile rules: a drawer
 * hides where you can go behind a gesture, which is wrong for an app whose whole
 * job is to put a decision in front of you.
 *
 * Secondary surfaces (Outreach, Interviews, CV, Portals) are reached from the
 * surface that owns them and from Settings, and each lights the tab it belongs
 * under (see mobile-routes.mjs) so the bar never goes dark.
 */

const ICONS: Record<string, ComponentType<SVGProps<SVGSVGElement>>> = {
  today: LayoutDashboard,
  explore: Compass,
  agent: Sparkles,
  pipeline: ListChecks,
  analytics: BarChart3,
};

export function MobileTabBar() {
  const pathname = usePathname();
  const current = activeTab(pathname);
  const { count } = useDecisionCount();

  return (
    <nav
      aria-label="Primary"
      // pb accounts for the home-bar inset so the last row of pixels is tappable
      // on a notched device in standalone mode (env() is 0 in a browser tab).
      className="co-tabbar fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-surface/95 backdrop-blur md:hidden"
    >
      {MOBILE_TABS.map(({ id, href, label }) => {
        const Icon = ICONS[id] ?? LayoutDashboard;
        const active = current === id;
        const badge = id === "today" && count && count > 0 ? count : null;
        return (
          <Link
            key={id}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              // 44px minimum hit target, per the prototype's mobile rules.
              "flex min-h-[46px] flex-1 flex-col items-center justify-center gap-0.5 py-1.5 transition-colors",
              active ? "text-brand-text" : "text-faint",
            )}
          >
            <span className="relative">
              <Icon className="size-[18px]" aria-hidden />
              {badge !== null && (
                <span
                  aria-hidden
                  className="absolute -right-2.5 -top-1 min-w-[14px] rounded-full bg-brand px-1 text-center text-[8.5px] font-bold leading-[14px] text-brand-foreground"
                >
                  {badge > 9 ? "9+" : badge}
                </span>
              )}
            </span>
            <span className="text-[9.5px] font-semibold">
              {label}
              {badge !== null && <span className="sr-only"> — {badge} waiting</span>}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
