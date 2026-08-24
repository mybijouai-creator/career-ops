"use client";

import { MobileHeader } from "@/components/mobile/mobile-header";
import { MobileTabBar } from "@/components/mobile/mobile-tab-bar";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { OfflineBanner } from "@/components/pwa/offline-banner";

/**
 * MobileChrome — everything that frames a mobile surface: the header, the two
 * status banners, and the bottom tab bar. Desktop (≥ md) renders none of it and
 * keeps the sidebar shell untouched.
 *
 * The banners sit BELOW the header and above the page so they push content
 * rather than float over it: an install prompt or an offline warning that
 * overlaps the first card is how you get a mis-tap on the surface whose whole
 * purpose is a one-tap decision.
 */
export function MobileChrome() {
  return (
    <>
      <MobileHeader />
      <div className="flex flex-col gap-2 px-3.5 pt-2.5 md:hidden empty:hidden">
        <OfflineBanner />
        <InstallPrompt />
      </div>
      <MobileTabBar />
    </>
  );
}
