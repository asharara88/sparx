"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * One tap with a Google account: no password, no e-mail link. Google hands the browser
 * back to /auth/callback like an e-mail link does, so an invite the device is on is
 * honoured (lib/join.ts) and an e-mail an admin listed links the account as before.
 * Needs the Google provider switched on in Supabase (README, "Auth settings"); until
 * then the browser goes to Supabase's authorize endpoint, which sends it back to
 * /auth/callback with the error, and that screen says so in plain words.
 */
export function GoogleButton({ onError, label = "Continue with Google", beforeRedirect }: { onError: (message: string) => void; label?: string; beforeRedirect?: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    // Whatever the page must have saved before the browser leaves (an invite screen
    // remembers its link in a cookie) is awaited here, so a quick tap cannot lose it.
    if (beforeRedirect) await beforeRedirect();
    const { error } = await supabaseBrowser().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback`, queryParams: { prompt: "select_account" } },
    });
    if (error) {
      setBusy(false);
      onError(error.message);
    }
    // Otherwise the browser is on its way to Google; stay busy until it leaves.
  }

  return (
    <button type="button" className="btn w-full text-lg" onClick={go} disabled={busy} aria-label={label}>
      <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.5 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.5-4.1 7-10.2 7-17.6z" />
        <path fill="#FBBC05" d="M10.5 28.6A14.5 14.5 0 0 1 9.7 24c0-1.6.3-3.2.8-4.6l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.9-6.1z" />
        <path fill="#34A853" d="M24 48c6.3 0 11.7-2.1 15.6-5.7l-7.6-5.9c-2.1 1.4-4.8 2.3-8 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
      </svg>
      {busy ? "Opening Google…" : label}
    </button>
  );
}
