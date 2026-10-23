"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Choose a password for the signed-in account (Me → Set or change password, or after a reset
 * link). An account that only ever signed in by e-mail link sets its first one here.
 */
export function PasswordForm({ afterReset = false }: { afterReset?: boolean }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setMsg("Use at least 8 characters.");
    if (password !== password2) return setMsg("The two passwords are not the same.");
    setBusy(true);
    setMsg(null);
    const { error } = await supabaseBrowser().auth.updateUser({ password });
    setBusy(false);
    if (error) return setMsg(error.message);
    setMsg("Saved.");
    router.replace("/");
    router.refresh();
  }

  return (
    <form onSubmit={save} className="card flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{afterReset ? "Choose a new password" : "Set or change password"}</h2>
      {!afterReset && <p className="muted">Signed in by e-mail link so far? Choose a password here and next time you can sign in with it.</p>}
      <label className="flex flex-col gap-1">
        <span className="font-semibold">New password</span>
        <input className="input" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        <span className="muted text-sm">At least 8 characters.</span>
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-semibold">The same password again</span>
        <input className="input" type="password" autoComplete="new-password" required minLength={8} value={password2} onChange={(e) => setPassword2(e.target.value)} />
      </label>
      {msg && (
        <p role="status" className={`notice ${msg === "Saved." ? "notice-ok" : "notice-danger"}`}>
          {msg}
        </p>
      )}
      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save password"}
      </button>
    </form>
  );
}
