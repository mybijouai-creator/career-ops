"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { useToast } from "@/components/mobile/toast";

/**
 * PushToggle — subscribe this device to notifications.
 *
 * Push has a long, silent failure chain (browser support → permission → service
 * worker → VAPID key → the push service), so this reports which link is broken
 * rather than a single "off": a toggle that just fails is unfixable by the user.
 *
 * Permission is requested on the TAP, never on mount. A permission prompt the
 * user did not ask for is the fastest way to a permanent "denied", and denied is
 * not recoverable from the page — only from browser settings.
 */

type State = "loading" | "unsupported" | "unavailable" | "denied" | "off" | "on" | "busy";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  // The VAPID key is base64url; PushManager wants raw bytes.
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function PushToggle() {
  const [state, setState] = useState<State>("loading");
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const { toast } = useToast();

  const probe = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setState("unsupported");
      return;
    }
    try {
      const r = await fetch("/api/push/key");
      const d = (await r.json()) as { available?: boolean; publicKey?: string };
      if (!d.available || !d.publicKey) {
        setState("unavailable");
        return;
      }
      setPublicKey(d.publicKey);
    } catch {
      setState("unavailable");
      return;
    }
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      setState(existing ? "on" : "off");
    } catch {
      setState("off");
    }
  }, []);

  useEffect(() => {
    void probe();
  }, [probe]);

  const enable = async () => {
    if (!publicKey) return;
    setState("busy");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        // Required by Chrome, and the honest setting regardless: every
        // notification this app sends is user-visible.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      if (!res.ok) throw new Error("the server refused the subscription");
      setState("on");
      toast("Notifications on for this device. Gate alerts carry no diff content.");
    } catch (e) {
      setState("off");
      toast(e instanceof Error ? e.message : "Could not enable notifications.", "warn");
    }
  };

  const disable = async () => {
    setState("busy");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setState("off");
      toast("Notifications off for this device.", "warn");
    } catch {
      setState("on");
      toast("Could not turn notifications off.", "warn");
    }
  };

  const sendTest = async () => {
    try {
      const r = await fetch("/api/push/test", { method: "POST" });
      const d = (await r.json()) as { sent?: number; reason?: string };
      toast(d.sent ? `Test sent to ${d.sent} device${d.sent === 1 ? "" : "s"}.` : (d.reason ?? "Nothing to send to."), d.sent ? "ok" : "warn");
    } catch {
      toast("Could not send the test.", "warn");
    }
  };

  const COPY: Record<State, string> = {
    loading: "checking…",
    unsupported: "this browser has no Web Push",
    unavailable: "no signing key on the server — push is unavailable",
    denied: "blocked in browser settings — only you can undo that, from the site permissions",
    off: "gate opened, worker finished, follow-up due, posting closed",
    on: "on for this device · gate alerts carry no diff content",
    busy: "…",
  };

  const on = state === "on";
  const actionable = state === "off" || state === "on";

  return (
    <div className="flex min-h-[52px] items-center gap-3 px-4 py-2.5">
      {on ? <Bell className="size-4 shrink-0 text-brand-text" aria-hidden /> : <BellOff className="size-4 shrink-0 text-faint" aria-hidden />}
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium">Notifications</div>
        <div className="text-[10.5px] leading-snug text-faint">{COPY[state]}</div>
      </div>
      {on && (
        <button type="button" onClick={() => void sendTest()} className="min-h-[34px] rounded-lg border border-border px-2 text-[11px] text-muted">
          Test
        </button>
      )}
      {state === "busy" || state === "loading" ? (
        <Loader2 className="size-4 shrink-0 animate-spin text-faint" aria-hidden />
      ) : (
        <button
          type="button"
          disabled={!actionable}
          onClick={() => void (on ? disable() : enable())}
          aria-pressed={on}
          className={`relative h-[23px] w-10 shrink-0 rounded-full transition-colors disabled:opacity-40 ${on ? "bg-brand" : "bg-border"}`}
        >
          <span className="sr-only">{on ? "Turn notifications off" : "Turn notifications on"}</span>
          <span
            aria-hidden
            className={`absolute top-[2.5px] size-[18px] rounded-full transition-[left] ${on ? "left-[20px] bg-brand-foreground" : "left-[2.5px] bg-faint"}`}
          />
        </button>
      )}
    </div>
  );
}
