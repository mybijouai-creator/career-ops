"use client";

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

/**
 * InstallPrompt — the "Add to home screen" banner from the PWA prototype.
 *
 * Only ever shown when the browser has actually offered an install
 * (`beforeinstallprompt`), so it cannot advertise a button that does nothing.
 * iOS never fires that event, so iOS Safari gets the short manual instruction
 * instead of a dead Install button — the one place the two platforms need
 * different copy rather than a shared lie.
 *
 * Dismissal is remembered. A banner that returns on every launch is an
 * anti-feature on the surface that is supposed to be the decision queue.
 */

const DISMISSED_KEY = "career-ops:install-dismissed";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS Safari's own flag, which predates display-mode.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIosSafari(): boolean {
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return iOS && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    // Already installed: nothing to offer.
    if (isStandalone()) return;
    try {
      if (localStorage.getItem(DISMISSED_KEY) === "1") return;
    } catch {
      /* storage blocked — show it, and dismissal just won't persist */
    }

    const onPrompt = (e: Event) => {
      // Keep the event: calling prompt() later is the only way to show the
      // native sheet at a moment the user actually asked for it.
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    if (isIosSafari()) setIosHint(true);

    const onInstalled = () => {
      setDeferred(null);
      setIosHint(false);
    };
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const dismiss = () => {
    setDeferred(null);
    setIosHint(false);
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    setDeferred(null);
    // A declined install is a "not now", not a "never" — but re-asking on the
    // next launch is nagging, so it is remembered either way.
    if (outcome) dismiss();
  };

  if (!deferred && !iosHint) return null;

  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-brand/30 bg-brand-soft px-3 py-2.5">
      <Download className="size-4 shrink-0 text-brand-text" aria-hidden />
      <p className="flex-1 text-[11.5px] leading-snug text-brand-text">
        {deferred ? (
          <>Add to home screen — reports and pipeline stay readable offline.</>
        ) : (
          <>
            Add to home screen for offline reports: tap <span className="font-semibold">Share</span> then{" "}
            <span className="font-semibold">Add to Home Screen</span>.
          </>
        )}
      </p>
      {deferred && (
        <button
          type="button"
          onClick={install}
          className="min-h-[34px] shrink-0 rounded-lg bg-brand px-3 text-[11.5px] font-semibold text-brand-foreground"
        >
          Install
        </button>
      )}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss install prompt"
        className="-mr-1 inline-flex min-h-[34px] min-w-[34px] shrink-0 items-center justify-center text-faint"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
