"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  discardIntent,
  getSnapshot,
  mutate,
  pendingIntents,
  pendingWrites,
  refreshSnapshot,
  replayNow,
  subscribe,
  confirmIntent,
  type MutateOutcome,
  type QueueAction,
  type QueuedEntry,
  type QueueSnapshot,
} from "@/lib/pwa/offline";

/**
 * PwaProvider — installs the service worker and owns the three pieces of state
 * the mobile surfaces read: are we online, what is queued, and what is waiting
 * for a human to re-confirm.
 *
 * Registration is deliberately late (after first paint, `load`): a worker that
 * competes with the first render for bandwidth makes the app feel slower to the
 * only user who has no cache yet.
 */

type PwaContextValue = {
  /** navigator.onLine, kept live. Starts `true` on the server so nothing flashes
   *  an offline banner during hydration. */
  online: boolean;
  /** Replayable writes + intents awaiting re-confirmation. */
  queue: QueueSnapshot;
  /** When the SW last refreshed a cached data response, for "cached 4m ago". */
  lastSyncAt: number | null;
  /** Service worker state, so the UI can be honest about whether offline works. */
  swState: "unsupported" | "pending" | "ready" | "failed";
  /** Perform a mutation with offline fallback. See lib/pwa/offline.ts. */
  mutate: typeof mutate;
  /** Re-read the queue (after a mutation the caller made itself). */
  refresh: () => Promise<void>;
  replay: () => Promise<void>;
  listWrites: () => Promise<QueuedEntry[]>;
  listIntents: () => Promise<QueuedEntry[]>;
  confirmIntent: (entry: QueuedEntry) => Promise<Response | null>;
  discardIntent: (id: number) => Promise<void>;
};

const noop = async () => {};

/** When the app was last demonstrably online, so the offline banner can say how
 *  stale the cached view is instead of just "offline". */
const LAST_SYNC_KEY = "career-ops:last-sync";

const PwaContext = createContext<PwaContextValue>({
  online: true,
  queue: { writes: 0, intents: 0 },
  lastSyncAt: null,
  swState: "pending",
  mutate: (async () => ({ kind: "unavailable", reason: "not ready" }) as MutateOutcome) as typeof mutate,
  refresh: noop,
  replay: noop,
  listWrites: async () => [],
  listIntents: async () => [],
  confirmIntent: async () => null,
  discardIntent: noop,
});

export function usePwa(): PwaContextValue {
  return useContext(PwaContext);
}

export function PwaProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [online, setOnline] = useState(true);
  const [queue, setQueue] = useState<QueueSnapshot>(() => getSnapshot());
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [swState, setSwState] = useState<PwaContextValue["swState"]>("pending");

  // Connectivity. `navigator.onLine` is read in an effect, never during render,
  // so the server and the first client render agree (no hydration mismatch).
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    // "cached 4m ago" has to mean something, so stamp the clock whenever we are
    // demonstrably online with the app open. Read back from localStorage on a
    // cold offline launch, when no SW message will ever arrive to set it.
    try {
      if (navigator.onLine) {
        const now = Date.now();
        localStorage.setItem(LAST_SYNC_KEY, String(now));
        setLastSyncAt(now);
      } else {
        const seen = Number(localStorage.getItem(LAST_SYNC_KEY));
        if (Number.isFinite(seen) && seen > 0) setLastSyncAt(seen);
      }
    } catch {
      /* storage blocked — the banner just omits the age */
    }
    const back = () => {
      setOnline(true);
      try {
        localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
      } catch {
        /* ignore */
      }
      // Reconnected: push whatever queued while we were away. Intents are NOT
      // included — replayNow only ever touches the writes store.
      void replayNow();
    };
    window.addEventListener("online", back);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", back);
      window.removeEventListener("offline", sync);
    };
  }, []);

  // Queue subscription.
  useEffect(() => {
    const unsub = subscribe(setQueue);
    void refreshSnapshot();
    return () => {
      unsub();
    };
  }, []);

  // Service worker registration + the message channel back from it.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      setSwState("unsupported");
      return;
    }
    let cancelled = false;

    const register = async () => {
      try {
        // A module worker, so sw.js can import the same policy files the app
        // uses. Chromium/Safari 16.4+/Firefox 114+ support this; older browsers
        // fail here and the app simply runs without offline support rather than
        // silently running a second, drifted copy of the rules.
        await navigator.serviceWorker.register("/sw.js", { type: "module", scope: "/" });
        await navigator.serviceWorker.ready;
        if (!cancelled) setSwState("ready");
      } catch {
        if (!cancelled) setSwState("failed");
      }
    };

    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; url?: string; pending?: number; intents?: number } | null;
      if (!data?.type) return;
      if (data.type === "queue-replayed") {
        setLastSyncAt(Date.now());
        void refreshSnapshot();
      }
      // A notification click on a already-open app: route in place rather than
      // letting the SW open a second window.
      if (data.type === "navigate" && data.url) router.push(data.url);
    };
    navigator.serviceWorker.addEventListener("message", onMessage);

    if (document.readyState === "complete") void register();
    else window.addEventListener("load", register, { once: true });

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("message", onMessage);
      window.removeEventListener("load", register);
    };
  }, [router]);

  const refresh = useCallback(async () => {
    await refreshSnapshot();
  }, []);

  const value = useMemo<PwaContextValue>(
    () => ({
      online,
      queue,
      lastSyncAt,
      swState,
      mutate: (async (action: QueueAction, opts) => {
        const out = await mutate(action, opts);
        await refreshSnapshot();
        return out;
      }) as typeof mutate,
      refresh,
      replay: replayNow,
      listWrites: pendingWrites,
      listIntents: pendingIntents,
      confirmIntent,
      discardIntent,
    }),
    [online, queue, lastSyncAt, swState, refresh],
  );

  return <PwaContext.Provider value={value}>{children}</PwaContext.Provider>;
}
