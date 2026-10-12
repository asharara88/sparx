"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

type Mode = "signin" | "signup" | "forgot" | "link";

/** Plain words for Supabase's error strings. */
function friendly(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) return "Wrong e-mail or password.";
  if (m.includes("email not confirmed")) return "Confirm your e-mail first: open the message we sent, then sign in.";
  if (m.includes("already registered") || m.includes("already been registered")) return "There is already an account for this e-mail. Sign in, or use “Forgot password”.";
  if (m.includes("rate limit")) return "Too many e-mails just now. Wait a little and try again.";
  if (m.includes("password should be")) return "Use at least 8 characters.";
  if (m.includes("failed to fetch")) return "No connection. Check the internet and try again.";
  return message;
}

/**
 * Sign in with e-mail and password. First time: "Create account" with the e-mail Mido or
 * Dana put on the household list. "Forgot password" and "e-mail me a link" use the same
 * one-time link mechanism and land on /auth/callback.
 */
export function LoginForm({ initialMode = "signin" }: { initialMode?: Mode }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const addr = () => email.trim().toLowerCase();
  const callback = () => `${window.location.origin}/auth/callback`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = supabaseBrowser();
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email: addr(), password });
        if (error) return setError(friendly(error.message));
        router.replace("/");
        router.refresh();
      } else if (mode === "signup") {
        if (password.length < 8) return setError("Use at least 8 characters.");
        if (password !== password2) return setError("The two passwords are not the same.");
        const { data, error } = await supabase.auth.signUp({ email: addr(), password, options: { emailRedirectTo: callback() } });
        if (error) return setError(friendly(error.message));
        if (data.user && data.user.identities && data.user.identities.length === 0) return setError(friendly("already registered"));
        if (data.session) {
          router.replace("/");
          router.refresh();
        } else {
          setDone(`We sent a message to ${addr()}. Open it and tap the button to confirm, then sign in.`);
        }
      } else if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(addr(), { redirectTo: `${callback()}?next=/me/password` });
        if (error) return setError(friendly(error.message));
        setDone(`We sent a message to ${addr()}. Tap the link in it and choose a new password.`);
      } else {
        const { error } = await supabase.auth.signInWithOtp({ email: addr(), options: { emailRedirectTo: callback() } });
        if (error) return setError(friendly(error.message));
        setDone(`We sent a link to ${addr()}. Tap it on this phone.`);
      }
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div role="status" className="rounded-xl border-2 border-green-700 p-4">
        <p className="text-lg font-semibold">Check your e-mail.</p>
        <p className="muted mt-1">{done}</p>
        <button className="btn mt-4 w-full" onClick={() => { setDone(null); setMode("signin"); }}>
          Back to sign in
        </button>
      </div>
    );
  }

  const title = mode === "signin" ? "Sign in" : mode === "signup" ? "Create your account" : mode === "forgot" ? "Forgot password" : "E-mail me a link";
  const hint =
    mode === "signin" ? "Your e-mail and password." :
    mode === "signup" ? "Use the e-mail Mido or Dana put on the household list, and choose a password." :
    mode === "forgot" ? "We will e-mail you a link to choose a new password." :
    "No password needed: we send a one-time link to your e-mail.";

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="muted">{hint}</p>
      </div>
      <label className="flex flex-col gap-1">
        <span className="font-semibold">Your e-mail</span>
        <input className="input" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
      </label>
      {(mode === "signin" || mode === "signup") && (
        <label className="flex flex-col gap-1">
          <span className="font-semibold">{mode === "signup" ? "Choose a password" : "Password"}</span>
          <input className="input" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} required minLength={mode === "signup" ? 8 : 1} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
      )}
      {mode === "signup" && (
        <label className="flex flex-col gap-1">
          <span className="font-semibold">The same password again</span>
          <input className="input" type="password" autoComplete="new-password" required minLength={8} value={password2} onChange={(e) => setPassword2(e.target.value)} />
        </label>
      )}
      {error && (
        <p className="rounded-xl border-2 border-red-700 p-3 text-red-800" role="alert">
          {error}
        </p>
      )}
      <button className="btn btn-primary w-full text-lg" type="submit" disabled={busy}>
        {busy ? "One moment…" : mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : mode === "forgot" ? "Send me the link" : "Send me a link"}
      </button>
      <div className="flex flex-col gap-2 text-center">
        {mode !== "signin" && (
          <button type="button" className="underline" onClick={() => { setMode("signin"); setError(null); }}>
            Back to sign in
          </button>
        )}
        {mode === "signin" && (
          <>
            <button type="button" className="underline" onClick={() => { setMode("signup"); setError(null); }}>
              First time here? Create your account
            </button>
            <button type="button" className="muted underline" onClick={() => { setMode("forgot"); setError(null); }}>
              Forgot password
            </button>
            <button type="button" className="muted underline" onClick={() => { setMode("link"); setError(null); }}>
              E-mail me a link instead
            </button>
          </>
        )}
      </div>
    </form>
  );
}
