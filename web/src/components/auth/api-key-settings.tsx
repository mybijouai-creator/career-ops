"use client";

import { useEffect, useState } from "react";
import { Check, KeyRound, Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";

type Me = { authenticated: boolean; user?: { id: string; email: string } };
type KeyInfo = { hasKey: boolean; provider?: string; masked?: string };

const PROVIDERS = [
  { id: "anthropic", label: "Anthropic (Claude)" },
  { id: "openai", label: "OpenAI" },
  { id: "google", label: "Google (Gemini)" },
  { id: "openrouter", label: "OpenRouter" },
] as const;

/**
 * Server-side, per-account API key storage — distinct from the (currently
 * unwired) "Paste an AI key" panel above, which is a browser-only, client-
 * calls-the-provider-directly design for the single-tenant case. This one is
 * for a hosted/multi-tenant deployment: the key is encrypted at rest and used
 * server-side so background workers can act on the signed-in user's behalf.
 * Renders nothing for a single-tenant install with no accounts — the /me
 * check below simply comes back unauthenticated and the section stays hidden.
 */
export function ApiKeySettings() {
  const [me, setMe] = useState<Me | null>(null);
  const [info, setInfo] = useState<KeyInfo | null>(null);
  const [provider, setProvider] = useState<string>("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d: Me) => setMe(d))
      .catch(() => setMe({ authenticated: false }));
  }, []);

  useEffect(() => {
    if (!me?.authenticated) return;
    fetch("/api/settings/api-key")
      .then((r) => (r.ok ? r.json() : { hasKey: false }))
      .then((d: KeyInfo) => {
        setInfo(d);
        if (d.provider) setProvider(d.provider);
      })
      .catch(() => setInfo({ hasKey: false }));
  }, [me?.authenticated]);

  if (!me?.authenticated) return null;

  const save = async () => {
    if (!apiKey.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/api-key", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error ?? "Couldn't save your key.");
        return;
      }
      setInfo(body);
      setApiKey("");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await fetch("/api/settings/api-key", { method: "DELETE" });
      setInfo({ hasKey: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-8">
      <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-muted">
        Your API key
      </label>
      <p className="mb-3 text-xs text-faint">
        Signed in as <span className="text-muted">{me.user?.email}</span>. Stored encrypted, used only to run your
        own evaluations — never shared with any other account.
      </p>

      {info?.hasKey && (
        <div className="mb-3 flex items-center justify-between rounded-xl border border-border bg-surface/50 px-4 py-2.5 text-sm">
          <span className="flex items-center gap-2 text-muted">
            <KeyRound className="size-3.5" />
            {PROVIDERS.find((p) => p.id === info.provider)?.label ?? info.provider} · <span className="font-mono">{info.masked}</span>
          </span>
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="inline-flex items-center gap-1 text-xs text-faint transition hover:text-red-500 disabled:opacity-60"
          >
            <Trash2 className="size-3.5" /> Remove
          </button>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setProvider(p.id)}
            className={cn(
              "rounded-xl border px-4 py-2.5 text-left text-sm transition-colors",
              provider === p.id
                ? "border-brand/50 bg-brand-soft text-foreground"
                : "border-border bg-surface/50 text-muted hover:bg-surface-hover hover:text-foreground",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      <input
        type="password"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder={info?.hasKey ? "Replace key…" : "sk-…"}
        autoComplete="off"
        className="mt-2 w-full rounded-xl border border-border bg-surface/60 px-4 py-2.5 font-mono text-sm outline-none transition-colors placeholder:text-faint focus:border-brand/50"
      />
      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
      <button
        type="button"
        onClick={save}
        disabled={busy || !apiKey.trim()}
        className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-1.5 text-xs font-medium text-brand-foreground transition-colors hover:bg-brand-200 disabled:opacity-50"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : saved ? <Check className="size-3.5" /> : null}
        {saved ? "Saved" : "Save key"}
      </button>
    </section>
  );
}
