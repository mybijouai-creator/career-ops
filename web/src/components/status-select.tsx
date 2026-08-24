"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { CANONICAL_STATES } from "@/lib/format";
import { usePwa } from "@/components/pwa/pwa-provider";
import { useToast } from "@/components/mobile/toast";

// Status writeback control. Updates the existing tracker row (status cell) via
// /api/status — never adds rows. Reverts on failure; confirms with the
// terminal-popup animation.
//
// Goes through the PWA queue rather than a bare fetch: a status advance is the
// canonical replayable mutation (HANDOFF §7b), so offline it is held with an
// idempotency key and replayed on reconnect instead of being lost. Online the
// queue is a pass-through and the server's own answer is what the user sees.
export function StatusSelect({ n, current }: { n: string; current: string }) {
  const [status, setStatus] = useState(current);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const { mutate } = usePwa();
  const { toast } = useToast();

  async function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    const prev = status;
    setStatus(next);
    setBusy(true);
    try {
      const out = await mutate("status-advance", { target: n, payload: { n, status: next } });
      if (out.kind === "sent") {
        if (!out.response.ok) throw new Error("write failed");
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
        router.refresh();
        return;
      }
      if (out.kind === "queued") {
        // The optimistic value STAYS: the write is durable in IndexedDB and will
        // land. Saying "saved" would be a lie, so the toast names the real state.
        toast(`Queued · ${next} will apply to data/applications.md when you reconnect.`, "queued");
        return;
      }
      throw new Error(out.kind === "unavailable" ? out.reason : "write failed");
    } catch {
      setStatus(prev); // revert on failure
    } finally {
      setBusy(false);
    }
  }

  const known = (CANONICAL_STATES as readonly string[]).includes(status);
  return (
    <span className="inline-flex items-center gap-2">
      <label className="text-xs text-faint">status</label>
      <select
        value={status}
        onChange={onChange}
        disabled={busy}
        className="rounded-md border border-border bg-surface px-2.5 py-1 text-sm text-foreground outline-none transition-colors focus:border-brand/50 disabled:opacity-50 max-sm:min-h-[44px]"
      >
        {!known && <option value={status}>{status}</option>}
        {CANONICAL_STATES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      {saved && (
        <span className="animate-terminal-popup inline-flex items-center gap-1 text-xs font-medium text-brand">
          <Check className="size-3" /> saved
        </span>
      )}
    </span>
  );
}
