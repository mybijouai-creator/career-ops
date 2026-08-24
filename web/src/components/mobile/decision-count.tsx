"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/**
 * The Today tab's badge count — how many things are waiting for a human.
 *
 * Published BY the Today surface rather than fetched by the tab bar. Today
 * already derives this from three reads it makes anyway (roles awaiting a
 * decision, follow-ups overdue, fresh scan results); having the tab bar fetch
 * the same three again just to draw a number would double the request load on
 * every route in the app.
 *
 * `/` is the manifest's `start_url`, so in the installed app Today is the first
 * surface seen and the count is populated before any other tab is reachable.
 * It is mirrored into sessionStorage so it survives navigation away from Today
 * within the session; with no value yet the badge simply does not render, which
 * is the honest state rather than a guessed zero.
 */

const KEY = "career-ops:decision-count";

type Ctx = { count: number | null; setCount: (n: number) => void };

const DecisionCountContext = createContext<Ctx>({ count: null, setCount: () => {} });

export function useDecisionCount() {
  return useContext(DecisionCountContext);
}

export function DecisionCountProvider({ children }: { children: React.ReactNode }) {
  const [count, setCountState] = useState<number | null>(null);

  // Read the mirror in an effect, never during render, so SSR and the first
  // client render agree.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(KEY);
      if (raw !== null) {
        const n = Number(raw);
        if (Number.isFinite(n) && n >= 0) setCountState(Math.trunc(n));
      }
    } catch {
      /* storage blocked — the badge stays hidden */
    }
  }, []);

  const setCount = useCallback((n: number) => {
    const safe = Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
    setCountState(safe);
    try {
      sessionStorage.setItem(KEY, String(safe));
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(() => ({ count, setCount }), [count, setCount]);
  return <DecisionCountContext.Provider value={value}>{children}</DecisionCountContext.Provider>;
}

/**
 * Mounted by the Today surface to publish its own count. A component rather
 * than a hook call so it can sit next to the markup that computed the number.
 */
export function PublishDecisionCount({ count }: { count: number }) {
  const { setCount } = useDecisionCount();
  useEffect(() => {
    setCount(count);
  }, [count, setCount]);
  return null;
}
