"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const supabase = supabaseBrowser();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setState("error");
      setMessage(error.message);
    } else {
      setState("sent");
    }
  }

  if (state === "sent") {
    return (
      <div role="status" className="rounded-xl border-2 border-green-700 p-4">
        <p className="text-lg font-semibold">Check your e-mail.</p>
        <p className="muted mt-1">We sent a link to {email}. Tap it on this phone.</p>
        <button className="btn mt-4 w-full" onClick={() => setState("idle")}>
          Use a different e-mail
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="font-semibold">Your e-mail</span>
        <input
          className="input"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@example.com"
        />
      </label>
      {state === "error" && (
        <p className="rounded-xl border-2 border-red-700 p-3 text-red-800" role="alert">
          {message}
        </p>
      )}
      <button className="btn btn-primary w-full text-lg" type="submit" disabled={state === "sending"}>
        {state === "sending" ? "Sending…" : "Send me a link"}
      </button>
    </form>
  );
}
