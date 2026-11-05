"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { Button, ErrorBox, Field, Input } from "@/components/ui";

export default function LoginPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(""); setInfo("");
    try {
      if (mode === "signin") {
        const { error } = await supabase().auth.signInWithPassword({ email, password });
        if (error) throw error;
        window.location.href = "/";
      } else {
        const { data, error } = await supabase().auth.signUp({
          email, password, options: { data: { full_name: name } },
        });
        if (error) throw error;
        if (data.session) window.location.href = "/";
        else setInfo("Account created. Check your email to confirm it, then sign in.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-xl bg-primary text-lg font-bold text-primary-fg">₹</div>
          <h1 className="text-xl font-semibold">Finance ERP OS</h1>
          <p className="text-sm text-muted">{mode === "signin" ? "Sign in to continue" : "Create your account"}</p>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
          {mode === "signup" && (
            <Field label="Full name"><Input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
          )}
          <Field label="Email"><Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
          <Field label="Password">
            <Input type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} minLength={6}
              value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          {error && <ErrorBox message={error} />}
          {info && <p className="rounded-md bg-success-soft px-3 py-2 text-sm text-success">{info}</p>}
          <Button variant="primary" type="submit" busy={busy}>{mode === "signin" ? "Sign in" : "Create account"}</Button>
          <button type="button" className="text-sm text-primary hover:underline"
            onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(""); setInfo(""); }}>
            {mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
