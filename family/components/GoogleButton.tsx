"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { friendlyAuthError } from "@/lib/auth-copy";

/** Google's four-colour "G", drawn inline so the button works offline and without a font. */
function GoogleMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.9 6.1C12.4 13.7 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.6 2.9-2.2 5.4-4.7 7.1l7.6 5.9c4.4-4.1 6.9-10.1 6.9-17z" />
      <path fill="#FBBC05" d="M10.5 28.6A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.6l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.2-13.5-10l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}

/**
 * "Continue with Google": one tap, no password and no e-mail link. Supabase sends the
 * person to Google and back to /auth/callback, which lands them where an e-mail link
 * would: the invite this phone was on (lib/join.ts), else the app. A Google account whose
 * e-mail an admin listed is linked by the same database trigger as any other sign-in.
 */
export function GoogleButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    const { error } = await supabaseBrowser().auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        // Always let the person pick the account: a shared family iPad must not sign in as whoever used it last.
        queryParams: { prompt: "select_account" },
      },
    });
    if (error) {
      setBusy(false);
      setError(friendlyAuthError(error.message));
    }
    // No error: the browser is on its way to Google.
  }

  return (
    <div className="flex flex-col gap-2">
      <button type="button" className="btn w-full text-lg" onClick={go} disabled={busy}>
        <GoogleMark /> {busy ? "One moment…" : "Continue with Google"}
      </button>
      {error && (
        <p className="notice notice-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
