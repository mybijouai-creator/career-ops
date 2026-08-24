"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

/**
 * The bottom sheet from the prototype.
 *
 * Per the prototype's mobile rules, detail that is read-then-dismissed opens as
 * a SHEET rather than pushing a route: "why did this score 4.4" is a glance, and
 * making it a route means a back navigation to get out of a glance.
 *
 * Accessibility is not optional here because the sheet is modal: scroll lock,
 * Escape, a focus trap, and focus restored to whatever opened it.
 */

export type SheetContent = {
  title: string;
  meta?: string;
  body: React.ReactNode;
  /** Monospace provenance line — which file this came from. */
  file?: string;
  primaryLabel?: string;
  onPrimary?: () => void;
};

type Ctx = { open: (c: SheetContent) => void; close: () => void };
const SheetContext = createContext<Ctx>({ open: () => {}, close: () => {} });

export function useSheet() {
  return useContext(SheetContext);
}

export function SheetProvider({ children }: { children: React.ReactNode }) {
  const [content, setContent] = useState<SheetContent | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const open = useCallback((c: SheetContent) => {
    openerRef.current = document.activeElement as HTMLElement | null;
    setContent(c);
  }, []);

  const close = useCallback(() => {
    setContent(null);
    // Return focus where it was, or the user loses their place in the list.
    openerRef.current?.focus?.();
    openerRef.current = null;
  }, []);

  useEffect(() => {
    if (!content) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const f = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (f.length === 0) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const t = window.setTimeout(() => panelRef.current?.querySelector<HTMLElement>("button, a")?.focus(), 60);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(t);
    };
  }, [content, close]);

  const value = useMemo(() => ({ open, close }), [open, close]);

  return (
    <SheetContext.Provider value={value}>
      {children}
      {content && (
        <div className="md:hidden">
          <div className="co-sheet-scrim fixed inset-0 z-50 bg-black/60" onClick={close} aria-hidden />
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={content.title}
            className="co-sheet fixed inset-x-0 bottom-0 z-50 max-h-[78%] overflow-y-auto rounded-t-[22px] border-t border-border bg-surface"
          >
            <div className="flex justify-center pb-1 pt-2.5">
              <span aria-hidden className="h-1 w-9 rounded-full bg-border" />
            </div>
            <div className="px-4 pb-6 pt-1.5">
              <div className="flex items-baseline gap-2">
                <h2 className="text-[14px] font-semibold">{content.title}</h2>
                {content.meta && <span className="ml-auto font-mono text-[10px] text-faint">{content.meta}</span>}
              </div>
              <div className="mt-2.5 text-[12px] leading-relaxed text-muted">{content.body}</div>
              {content.file && <p className="mt-2.5 font-mono text-[10.5px] text-faint">{content.file}</p>}
              <div className="mt-3.5 flex flex-col gap-2">
                {content.primaryLabel && (
                  <button
                    type="button"
                    onClick={() => {
                      const act = content.onPrimary;
                      close();
                      act?.();
                    }}
                    className="min-h-[46px] rounded-xl bg-brand text-[12.5px] font-semibold text-brand-foreground"
                  >
                    {content.primaryLabel}
                  </button>
                )}
                <button
                  type="button"
                  onClick={close}
                  className="min-h-[44px] rounded-xl border border-border bg-surface text-[12px] font-medium text-muted"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </SheetContext.Provider>
  );
}
