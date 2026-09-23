"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { MailCheck } from "lucide-react";
import { getSupabaseBrowser } from "@/lib/supabase/client";

export function LoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(params.get("error"));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const next = params.get("next") ?? "/";
    const redirect = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    const { error } = await getSupabaseBrowser().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirect },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  if (sent) {
    return (
      <div className="mt-8 rounded-2xl bg-surface px-5 py-6 text-center">
        <MailCheck className="mx-auto h-9 w-9 text-label-2" strokeWidth={1.75} />
        <p className="mt-3 text-[17px] font-semibold">Check your email</p>
        <p className="mt-1 text-[15px] text-label-2">
          We sent a sign-in link to <span className="font-medium text-label">{email}</span>. Open the link on this device to sign in.
        </p>
        <button type="button" className="btn-text mx-auto mt-3" onClick={() => setSent(false)}>
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-3">
      {error ? <p className="rounded-xl bg-danger-soft px-4 py-2.5 text-[15px] text-danger">{error}</p> : null}
      <input
        type="email"
        required
        autoFocus
        autoComplete="email"
        inputMode="email"
        aria-label="Email"
        className="field !bg-surface"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <button type="submit" className="btn-primary w-full" disabled={busy || !email}>
        {busy ? "Sending…" : "Email me a sign-in link"}
      </button>
      <p className="pt-2 text-center text-[13px] text-label-2">Only approved emails can sign in.</p>
    </form>
  );
}
