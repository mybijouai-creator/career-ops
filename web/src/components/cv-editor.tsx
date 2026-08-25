"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Clock, Loader2, Plus, Star, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";

type CvMeta = { id: string; name: string; active: boolean; updatedAt: string };
type CvList = { activeId: string | null; cvs: CvMeta[] };
type HistoryEntry = {
  date: string;
  reportNum: string;
  companySlug: string;
  companyLabel: string;
  baseCvId: string | null;
  baseCvName: string | null;
  outputFile: string;
};

/**
 * The CV editor. Two modes, chosen entirely by whether /api/cvs has ever seen
 * a write for this tenant:
 *
 * - No named CVs yet (a fresh account, or one that predates this feature and
 *   has never opened the switcher): behaves exactly as before — one editor,
 *   backed by GET/POST /api/cv, editing cv.md directly. A "Save as a named
 *   CV…" affordance is the on-ramp into the richer mode; nothing forces it.
 * - One or more named CVs: a switcher lists them (active one mirrored into
 *   cv.md — see cv-library.mjs), editing goes through /api/cvs/:id, and a
 *   History panel lists every tailored CV a `pdf` run has actually rendered
 *   (cv-history.mjs), each downloadable by its exact file.
 */
export function CvEditor() {
  const [cvs, setCvs] = useState<CvList | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [legacyExists, setLegacyExists] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<{ entries: HistoryEntry[] } | null>(null);

  const multi = !!cvs && cvs.cvs.length > 0;

  useEffect(() => {
    fetch("/api/cvs")
      .then((r) => r.json())
      .then((d: CvList) => {
        setCvs(d);
        if (d.cvs.length > 0) {
          const target = d.activeId ?? d.cvs[0].id;
          setSelectedId(target);
          return fetch(`/api/cvs/${target}`)
            .then((r) => r.json())
            .then((body: { cv?: { content: string } }) => setContent(body.cv?.content ?? ""));
        }
        return fetch("/api/cv")
          .then((r) => r.json())
          .then((legacy: { content: string; exists: boolean }) => {
            setContent(legacy.content ?? "");
            setLegacyExists(legacy.exists ?? false);
          });
      })
      .catch(() => setError("Couldn't load your CV."))
      .finally(() => setLoaded(true));
  }, []);

  function loadCv(id: string) {
    setBusy(true);
    fetch(`/api/cvs/${id}`)
      .then((r) => r.json())
      .then((body: { cv?: { content: string } }) => {
        setSelectedId(id);
        setContent(body.cv?.content ?? "");
        setDirty(false);
      })
      .finally(() => setBusy(false));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = multi && selectedId
        ? await fetch(`/api/cvs/${selectedId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content }),
          })
        : await fetch("/api/cv", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content }),
          });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? "Couldn't save your CV.");
        return;
      }
      setDirty(false);
      setLegacyExists(true);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      if (multi && selectedId) {
        setCvs((prev) => (prev ? { ...prev, cvs: prev.cvs.map((c) => (c.id === selectedId ? { ...c, updatedAt: new Date().toISOString() } : c)) } : prev));
      }
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setSaving(false);
    }
  }

  async function createNamedCv(name: string, seedFromCurrent: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/cvs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, content: seedFromCurrent ? content : "" }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error ?? "Couldn't create that CV.");
        return;
      }
      const listRes = await fetch("/api/cvs");
      const list: CvList = await listRes.json();
      setCvs(list);
      setSelectedId(body.cv.id);
      setContent(seedFromCurrent ? content : "");
      setDirty(false);
    } finally {
      setBusy(false);
    }
  }

  async function activate(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/cvs/${id}/activate`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? "Couldn't activate that CV.");
        return;
      }
      const listRes = await fetch("/api/cvs");
      setCvs(await listRes.json());
    } finally {
      setBusy(false);
    }
  }

  async function removeCv(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/cvs/${id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? "Couldn't delete that CV.");
        return;
      }
      const listRes = await fetch("/api/cvs");
      const list: CvList = await listRes.json();
      setCvs(list);
      if (selectedId === id) {
        const fallback = list.activeId ?? list.cvs[0]?.id ?? null;
        if (fallback) loadCv(fallback);
      }
    } finally {
      setBusy(false);
    }
  }

  function loadHistory() {
    setShowHistory((prev) => !prev);
    if (history) return;
    fetch("/api/cvs/history")
      .then((r) => r.json())
      .then((d: { entries: HistoryEntry[] }) => setHistory(d))
      .catch(() => setHistory({ entries: [] }));
  }

  const selectedMeta = cvs?.cvs.find((c) => c.id === selectedId);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl tracking-tight text-landing">CV editor</h1>
          <p className="mt-1 text-sm text-muted">
            {multi ? (
              <>
                Editing <span className="text-foreground">{selectedMeta?.name ?? "…"}</span>
                {selectedMeta?.active && <span className="ml-1 text-faint">— mirrored into cv.md, the CV every evaluation reads.</span>}
              </>
            ) : (
              <>
                Edit <code className="text-foreground">cv.md</code> with live preview.
                {!legacyExists && loaded && <span className="ml-1 text-faint">No cv.md yet — start typing to create it.</span>}
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadHistory}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-4 py-2 text-sm text-muted transition-colors hover:bg-surface-hover hover:text-foreground max-sm:min-h-[44px]"
          >
            <Clock className="size-4" /> History
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty}
            className={cn(
              "inline-flex items-center justify-center gap-2 rounded-full px-5 py-2 text-sm font-medium transition-colors max-sm:min-h-[44px]",
              dirty ? "bg-brand text-brand-foreground hover:bg-brand-200" : "border border-border bg-surface text-muted",
            )}
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : saved ? <Check className="size-4" /> : null}
            {saved ? "Saved" : "Save"}
          </button>
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

      {!loaded ? (
        <div className="mt-6 text-sm text-muted">Loading…</div>
      ) : (
        <>
          <CvSwitcher
            cvs={cvs}
            selectedId={selectedId}
            busy={busy}
            onSelect={loadCv}
            onCreate={createNamedCv}
            onActivate={activate}
            onDelete={removeCv}
            offerUpgrade={!multi}
          />

          {showHistory && <CvHistoryPanel history={history} />}

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <textarea
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
                setDirty(true);
              }}
              spellCheck={false}
              placeholder="# Your Name&#10;&#10;## Summary&#10;..."
              className="min-h-[60vh] w-full resize-none rounded-2xl border border-border bg-surface/50 p-4 font-mono text-sm leading-relaxed outline-none transition-colors placeholder:text-faint focus:border-brand/40"
            />
            <article className="report-prose min-h-[60vh] overflow-auto rounded-2xl border border-border bg-surface/30 p-5">
              {content.trim() ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
              ) : (
                <p className="text-muted">Preview appears here.</p>
              )}
            </article>
          </div>
        </>
      )}
    </div>
  );
}

function CvSwitcher({
  cvs,
  selectedId,
  busy,
  onSelect,
  onCreate,
  onActivate,
  onDelete,
  offerUpgrade,
}: {
  cvs: CvList | null;
  selectedId: string | null;
  busy: boolean;
  onSelect: (id: string) => void;
  onCreate: (name: string, seedFromCurrent: boolean) => void;
  onActivate: (id: string) => void;
  onDelete: (id: string) => void;
  offerUpgrade: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const submitCreate = () => {
    const name = newName.trim();
    if (!name) return;
    onCreate(name, offerUpgrade);
    setNewName("");
    setCreating(false);
  };

  if (offerUpgrade) {
    return (
      <div className="mt-4">
        {creating ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitCreate()}
              placeholder="e.g. Backend, AI/ML, Management"
              className="rounded-xl border border-border bg-surface/60 px-3 py-1.5 text-sm outline-none focus:border-brand/50"
            />
            <button type="button" onClick={submitCreate} className="rounded-full bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground hover:bg-brand-200">
              Save as named CV
            </button>
            <button type="button" onClick={() => setCreating(false)} className="text-xs text-faint hover:text-muted">
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setCreating(true)} className="text-xs text-muted underline decoration-dotted underline-offset-4 hover:text-foreground">
            Targeting more than one type of role? Save this as a named CV to keep several…
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {cvs?.cvs.map((c) => (
        <div
          key={c.id}
          className={cn(
            "group flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors",
            c.id === selectedId ? "border-brand/50 bg-brand-soft text-foreground" : "border-border bg-surface/50 text-muted hover:bg-surface-hover",
          )}
        >
          <button type="button" onClick={() => onSelect(c.id)} className="flex items-center gap-1.5">
            {c.active && <Star className="size-3 fill-current text-brand" />}
            {c.name}
          </button>
          {!c.active && c.id === selectedId && (
            <>
              <button type="button" onClick={() => onActivate(c.id)} disabled={busy} title="Make active (mirror into cv.md)" className="text-faint hover:text-brand disabled:opacity-50">
                <Star className="size-3" />
              </button>
              <button type="button" onClick={() => onDelete(c.id)} disabled={busy} title="Delete" className="text-faint hover:text-red-500 disabled:opacity-50">
                <Trash2 className="size-3" />
              </button>
            </>
          )}
        </div>
      ))}
      {creating ? (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitCreate()}
            placeholder="CV name…"
            className="rounded-full border border-border bg-surface/60 px-3 py-1.5 text-sm outline-none focus:border-brand/50"
          />
          <button type="button" onClick={submitCreate} className="text-xs text-brand hover:underline">
            Create
          </button>
          <button type="button" onClick={() => setCreating(false)} className="text-xs text-faint hover:text-muted">
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-3 py-1.5 text-sm text-faint transition-colors hover:border-brand/40 hover:text-foreground"
        >
          <Plus className="size-3.5" /> New CV
        </button>
      )}
    </div>
  );
}

function CvHistoryPanel({ history }: { history: { entries: HistoryEntry[] } | null }) {
  return (
    <div className="mt-4 rounded-2xl border border-border bg-surface/30 p-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted">Tailored CV history</p>
      {!history ? (
        <p className="text-sm text-faint">Loading…</p>
      ) : history.entries.length === 0 ? (
        <p className="text-sm text-faint">No tailored CVs yet — generate one from a report's PDF step.</p>
      ) : (
        <ul className="divide-y divide-border/60 text-sm">
          {history.entries.map((e) => (
            <li key={`${e.reportNum}-${e.outputFile}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="text-muted">
                <span className="text-foreground">{e.companyLabel}</span>
                <span className="mx-1.5 text-faint">·</span>
                {e.date}
                <span className="mx-1.5 text-faint">·</span>
                report #{e.reportNum}
                {e.baseCvName && (
                  <>
                    <span className="mx-1.5 text-faint">·</span>from {e.baseCvName}
                  </>
                )}
              </span>
              <a
                href={`/api/cvs/history/file/${encodeURIComponent(e.outputFile)}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-brand hover:underline"
              >
                Open PDF
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
