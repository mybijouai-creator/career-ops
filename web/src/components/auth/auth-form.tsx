"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { instrumentSerif } from "@/lib/fonts";
import { CoMark } from "@/components/co-mark";

export function AuthForm({ mode }: { mode: "signup" | "login" }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? "Something went wrong — try again.");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Couldn't reach the server — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const isSignup = mode === "signup";

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-10">
      <div className="mb-8 flex flex-col items-center text-center">
        <CoMark size={40} />
        <h1 className={`${instrumentSerif.className} mt-4 text-3xl text-foreground`}>
          {isSignup ? "Create your account" : "Welcome back"}
        </h1>
        <p className="mt-1.5 text-[13.5px] text-muted">
          {isSignup ? "Bring your own API key — nothing charged to anyone else's account." : "Sign in to your career-ops workspace."}
        </p>
      </div>

      <form onSubmit={submit} className="space-y-3">
        <div>
          <label htmlFor="email" className="mb-1.5 block text-[12.5px] font-medium text-muted">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-border bg-surface px-3 py-2.5 text-[14px] text-foreground outline-none focus:border-brand/50"
          />
        </div>
        <div>
          <label htmlFor="password" className="mb-1.5 block text-[12.5px] font-medium text-muted">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={isSignup ? 8 : undefined}
            autoComplete={isSignup ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-border bg-surface px-3 py-2.5 text-[14px] text-foreground outline-none focus:border-brand/50"
          />
          {isSignup && <p className="mt-1 text-[11.5px] text-faint">At least 8 characters.</p>}
        </div>

        {error && (
          <p role="alert" className="rounded-md bg-red-500/10 px-3 py-2 text-[12.5px] text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="flex w-full items-center justify-center gap-1.5 rounded-md bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          {isSignup ? "Create account" : "Sign in"}
        </button>
      </form>

      <p className="mt-5 text-center text-[12.5px] text-faint">
        {isSignup ? (
          <>
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-brand-text hover:underline">
              Sign in
            </Link>
          </>
        ) : (
          <>
            New here?{" "}
            <Link href="/signup" className="font-medium text-brand-text hover:underline">
              Create an account
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
