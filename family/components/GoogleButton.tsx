"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { GOOGLE_CLIENT_ID, GOOGLE_LOGIN_PATH, googleButtonWidth } from "@/lib/google";

type Props = { onError: (message: string) => void; label?: string; signup?: boolean; beforeRedirect?: () => Promise<unknown> };

/**
 * One tap with a Google account: no password, no e-mail link.
 *
 * With `NEXT_PUBLIC_GOOGLE_CLIENT_ID` set, this is Google's own button (Google Identity
 * Services): Google's screen names elnunu.com, and it posts an ID token to /auth/google,
 * which signs the person in and lands them where an e-mail link would: the invite this
 * device was on (lib/join.ts), else the app. Nothing of Supabase shows.
 *
 * Without it, or if Google's script cannot load (offline, a blocker), the fallback is
 * Supabase's redirect flow, where Google's screen shows the project's address instead.
 * That needs the Google provider on in Supabase (README, "Google sign-in"); until then
 * the tap says so in plain words and stays on the page.
 */
export function GoogleButton(props: Props) {
  const [fallback, setFallback] = useState(!GOOGLE_CLIENT_ID);
  const onUnavailable = useCallback(() => setFallback(true), []);
  if (fallback) return <RedirectButton {...props} />;
  return <GisButton {...props} onUnavailable={onUnavailable} />;
}

/* ---- Google's own button ------------------------------------------------------- */

type Gis = {
  accounts: {
    id: {
      initialize(config: Record<string, unknown>): void;
      renderButton(el: HTMLElement, options: Record<string, unknown>): void;
    };
  };
};
declare global {
  interface Window {
    google?: Gis;
  }
}

let gisLoading: Promise<Gis> | null = null;
/** Loads Google's script once per page; rejects when it cannot load, so the caller can fall back. */
function loadGis(): Promise<Gis> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  if (!gisLoading) {
    gisLoading = new Promise<Gis>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.defer = true;
      s.onload = () => (window.google?.accounts?.id ? resolve(window.google) : reject(new Error("no gis")));
      s.onerror = () => {
        gisLoading = null;
        reject(new Error("gis failed to load"));
      };
      document.head.appendChild(s);
    });
  }
  return gisLoading;
}

function GisButton({ signup, beforeRedirect, onUnavailable }: Props & { onUnavailable: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  // The parent form re-renders on every keystroke; the latest callbacks live in a ref so
  // the button is drawn once per mode, not once per letter typed.
  const latest = useRef({ beforeRedirect, onUnavailable });
  latest.current = { beforeRedirect, onUnavailable };

  useEffect(() => {
    let gone = false;
    loadGis().then(
      (google) => {
        if (gone || !box.current) return;
        const dark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
        google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          // A full-page trip to Google and back, never a popup: popups break inside the
          // installed app on iPhone. Google posts the token to our own address.
          ux_mode: "redirect",
          login_uri: `${window.location.origin}${GOOGLE_LOGIN_PATH}`,
          context: signup ? "signup" : "signin",
          itp_support: true,
        });
        google.accounts.id.renderButton(box.current, {
          type: "standard",
          size: "large",
          shape: "pill",
          theme: dark ? "filled_black" : "outline",
          text: signup ? "signup_with" : "continue_with",
          logo_alignment: "left",
          width: googleButtonWidth(box.current.clientWidth),
          // Google leaves the page as soon as the tap lands; the invite cookie is already
          // written when the join screen opened, this is one more chance for it.
          click_listener: () => {
            const before = latest.current.beforeRedirect;
            if (before) void before();
          },
        });
        setReady(true);
      },
      () => {
        if (!gone) latest.current.onUnavailable();
      },
    );
    return () => {
      gone = true;
    };
    // Drawn once per mode: a mode change remounts the box through the key below.
  }, [signup]);

  return (
    <div className="flex min-h-[48px] justify-center" aria-busy={!ready}>
      <div ref={box} key={signup ? "signup" : "signin"} className="w-full max-w-[400px]" />
    </div>
  );
}

/* ---- Fallback: Supabase's redirect flow --------------------------------------- */

function RedirectButton({ onError, label, signup, beforeRedirect }: Props) {
  const [busy, setBusy] = useState(false);
  const text = label ?? (signup ? "Create account with Google" : "Continue with Google");

  async function go() {
    setBusy(true);
    // Whatever the page must have saved before the browser leaves (an invite screen
    // remembers its link in a cookie) is awaited here, so a quick tap cannot lose it.
    if (beforeRedirect) await beforeRedirect();
    const { data, error } = await supabaseBrowser().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback`, queryParams: { prompt: "select_account" }, skipBrowserRedirect: true },
    });
    if (error || !data.url) {
      setBusy(false);
      return onError(error?.message ?? "Could not start Google sign-in.");
    }
    // With the provider off, Supabase answers the authorize address with a bare JSON error
    // page ("Unsupported provider: provider is not enabled") instead of coming back to the
    // app. Ask it first without following the redirect: a refusal is readable here and
    // becomes a plain sentence; anything else (the redirect to Google, no answer) goes ahead.
    try {
      const probe = await fetch(data.url, { redirect: "manual", credentials: "omit" });
      if (probe.status >= 400) {
        const body = (await probe.json().catch(() => null)) as { msg?: string; error_description?: string } | null;
        setBusy(false);
        return onError(body?.msg ?? body?.error_description ?? "provider is not enabled");
      }
    } catch {
      // Opaque or blocked: nothing to learn here; let the browser go.
    }
    window.location.assign(data.url);
    // The browser is on its way to Google; stay busy until it leaves.
  }

  return (
    <button type="button" className="btn w-full text-lg" onClick={go} disabled={busy} aria-label={text}>
      <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.5 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.5-4.1 7-10.2 7-17.6z" />
        <path fill="#FBBC05" d="M10.5 28.6A14.5 14.5 0 0 1 9.7 24c0-1.6.3-3.2.8-4.6l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.9-6.1z" />
        <path fill="#34A853" d="M24 48c6.3 0 11.7-2.1 15.6-5.7l-7.6-5.9c-2.1 1.4-4.8 2.3-8 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
      </svg>
      {busy ? "Opening Google…" : text}
    </button>
  );
}
