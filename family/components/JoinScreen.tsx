"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, supabaseBrowser } from "@/lib/supabase/client";
import { LoginForm } from "@/app/login/LoginForm";
import { joinPath } from "@/lib/join";
import { SignOutButton } from "./SignOutButton";

export interface Invite {
  ok: true;
  state: "open" | "joined" | "used" | "expired" | "gone";
  household_id: string;
  home: string;
  display_name: string;
  role: string | null;
  invited_by: string | null;
  expires_at: string;
}

/**
 * What an invite link opens on. Signed out: who is waiting for you, and the sign-in form
 * (the device remembers the link for an hour, so a sign-in by e-mail comes back here).
 * Signed in: one tap makes this account that member and the app opens in that home.
 */
export function JoinScreen({ token, invite, email, error = null }: { token: string | null; invite: Invite | null; email: string | null; error?: "google_off" | "link" | null }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Remember the link on this device while signing in (lib/join.ts): once as the screen
  // opens, and again, awaited, right before a sign-in sends the browser away (Google, an
  // e-mail link), so a tap faster than the first request cannot lose the invite.
  const remember = useCallback(
    () =>
      token
        ? apiFetch("/api/join/remember", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) }).then(() => undefined, () => undefined)
        : Promise.resolve(),
    [token],
  );
  useEffect(() => {
    if (!email && invite?.state === "open") void remember();
  }, [remember, email, invite?.state]);

  async function join() {
    if (!token) return;
    setBusy(true);
    setMsg(null);
    const { data, error } = await supabaseBrowser().rpc("member_invite_accept", { p_token: token });
    const res = data as { ok: boolean; error?: string; message?: string; household_id?: string } | null;
    // Already in that home as someone else: just go there.
    const home = res?.ok || res?.error === "already_member" ? res?.household_id : null;
    if (error || !home) {
      setBusy(false);
      return setMsg(res?.message ?? error?.message ?? "Could not join. Try again.");
    }
    // This device shows that home from now on; the whole app reloads for it.
    await apiFetch("/api/home/switch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ household_id: home }) }).catch(() => null);
    window.location.assign("/");
  }

  if (!token || !invite) {
    return (
      <div className="card flex flex-col gap-3">
        <h2 className="text-2xl font-bold">That link is not one we sent</h2>
        <p className="muted">It may have been copied wrongly. Ask the person who invited you to send it again.</p>
        <Link href="/login" className="btn">
          Go to sign in
        </Link>
      </div>
    );
  }

  const who = invite.invited_by ? `${invite.invited_by} added you` : "You were added";
  const as = `${invite.display_name}${invite.role ? ` (${invite.role.toLowerCase()})` : ""}`;

  if (invite.state === "gone" || invite.state === "expired" || (invite.state === "used" && !email)) {
    return (
      <div className="card flex flex-col gap-3">
        <h2 className="text-2xl font-bold">{invite.state === "expired" ? "This link is older than a week" : invite.state === "used" ? "This link has been used" : "That place is no longer there"}</h2>
        <p className="muted">
          {invite.state === "expired"
            ? `Links work for seven days. Ask ${invite.invited_by ?? "the admin"} of ${invite.home} to send a new one.`
            : invite.state === "used"
              ? `Someone has already joined ${invite.home} as ${invite.display_name}. If that was you, sign in. Otherwise ask ${invite.invited_by ?? "the admin"} for a new link.`
              : `Ask ${invite.invited_by ?? "the admin"} of ${invite.home} to add you again.`}
        </p>
        <Link href="/login" className="btn">
          Go to sign in
        </Link>
      </div>
    );
  }

  if (invite.state === "joined") {
    return (
      <div className="card flex flex-col gap-3">
        <h2 className="text-2xl font-bold">You are in {invite.home}</h2>
        <p className="muted">This account is {invite.display_name} there. Signed in as {email}.</p>
        <button className="btn btn-primary min-h-[56px] text-lg" onClick={join} disabled={busy}>
          {busy ? "Opening…" : `Open ${invite.home}`}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="card flex flex-col gap-2">
        <h2 className="text-2xl font-bold">Join {invite.home}</h2>
        <p>
          {who} to <b>{invite.home}</b> as <b>{as}</b>.
          {email ? " Tap below and the app opens in that home, with everything the family has logged." : " Sign in below with Google or any e-mail you like, and you are in."}
        </p>
        {email && (
          <>
            {msg && (
              <p className="notice notice-danger" role="alert">
                {msg}
              </p>
            )}
            <button className="btn btn-primary min-h-[56px] text-lg" onClick={join} disabled={busy}>
              {busy ? "Joining…" : `Join as ${invite.display_name}`}
            </button>
            <p className="muted text-sm">Signed in as {email}. Not you? Sign out and sign in as yourself, then open the link again.</p>
            <SignOutButton />
          </>
        )}
      </div>
      {!email && (
        <div className="card">
          {error && (
            <p className="notice notice-danger mb-4" role="alert">
              {error === "google_off" ? "Google sign-in is not switched on yet. Use your e-mail for now." : "That sign-in link did not work. It may be old. Ask for a new one below."}
            </p>
          )}
          <LoginForm next={joinPath(token)} joining beforeRedirect={remember} />
        </div>
      )}
    </div>
  );
}
