"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Check, AlertTriangle, CloudOff } from "lucide-react";

/**
 * The prototype's toast — the confirmation line that names the FILE a write
 * landed in ("Shortlisted Vercel · row appended to data/applications.md").
 *
 * That phrasing is the point, not decoration: files are the canonical store, so
 * a write is only really confirmed once the user can see which file moved. The
 * `queued` tone exists for the offline path, where the honest message is that
 * nothing has been written yet.
 */

export type ToastTone = "ok" | "warn" | "queued";
type Toast = { id: number; text: string; tone: ToastTone };

type Ctx = { toast: (text: string, tone?: ToastTone) => void };
const ToastContext = createContext<Ctx>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

const ICONS = { ok: Check, warn: AlertTriangle, queued: CloudOff } as const;
const TONES = {
  ok: "text-emerald-500 bg-emerald-500/15 dark:text-emerald-400",
  warn: "text-amber-500 bg-amber-500/15 dark:text-amber-400",
  queued: "text-sky-500 bg-sky-500/15 dark:text-sky-400",
} as const;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = useState<Toast | null>(null);
  const timer = useRef<number | null>(null);

  const toast = useCallback((text: string, tone: ToastTone = "ok") => {
    if (timer.current) window.clearTimeout(timer.current);
    setCurrent({ id: Date.now(), text, tone });
    timer.current = window.setTimeout(() => setCurrent(null), 3600);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  const value = useMemo(() => ({ toast }), [toast]);
  const Icon = current ? ICONS[current.tone] : Check;

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* aria-live so the confirmation is announced, not just drawn. Sits above
          the tab bar rather than over it. */}
      <div aria-live="polite" aria-atomic="true" className="pointer-events-none fixed inset-x-3.5 bottom-[84px] z-40 md:hidden">
        {current && (
          <div
            key={current.id}
            className="co-toast pointer-events-auto flex items-center gap-2.5 rounded-xl border border-border bg-surface px-3 py-2.5 shadow-lg"
          >
            <span className={`grid size-5 shrink-0 place-items-center rounded-md ${TONES[current.tone]}`}>
              <Icon className="size-3" aria-hidden />
            </span>
            <p className="flex-1 text-[11.5px] leading-snug text-muted">{current.text}</p>
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}
