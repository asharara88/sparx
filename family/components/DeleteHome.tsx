"use client";
import { useState } from "react";
import type { Household } from "@/lib/types";
import { apiFetch } from "@/lib/supabase/client";

/**
 * Admin: delete this home, everything in it, and its files. The name has to be
 * typed exactly; the server refuses anyone but an admin of the home, and the
 * first home on the deployment, which holds what every home shares.
 */
export function DeleteHome({ household, platform }: { household: Household; platform: boolean }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const matches = typed.trim().toLowerCase() === household.name.trim().toLowerCase();

  if (platform) {
    return (
      <p className="muted text-sm">
        This is the first home on elnunu. It holds the roles, entry types and helper skills every home shares, so it cannot be deleted from the app.
      </p>
    );
  }

  async function remove(e: React.FormEvent) {
    e.preventDefault();
    if (!matches || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await apiFetch("/api/home/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ household_id: household.id, name: typed.trim() }),
      });
      const res = (await r.json().catch(() => null)) as { ok?: boolean; message?: string; cleanup?: "done" | "pending" } | null;
      if (!r.ok || !res?.ok) {
        setBusy(false);
        return setMsg(res?.message ?? "Could not delete the home.");
      }
      setDone(res.cleanup === "done" ? "The home is gone, with its photos and backups." : "The home is gone. Its photos and backups are being removed in the background; the server keeps trying until they are.");
    } catch {
      setBusy(false);
      setMsg("Could not reach the server.");
    }
  }

  if (done) {
    return (
      <div className="card flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Deleted</h2>
        <p>{done}</p>
        <a href="/" className="btn btn-primary">
          Continue
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={remove} className="card flex flex-col gap-3 border border-[var(--danger)]">
      <h2 className="text-lg font-semibold">Delete this home</h2>
      <p className="muted text-sm">
        Everything goes: the members, the child&apos;s whole log, the chat, the photos and the backups. The people keep their accounts and any other home they are in. There is no undo.
      </p>
      <label className="flex flex-col gap-1">
        <span className="font-semibold">Type the home&apos;s name to confirm</span>
        <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={household.name} autoComplete="off" />
      </label>
      {msg && (
        <p className="notice notice-danger" role="alert">
          {msg}
        </p>
      )}
      <button type="submit" className="btn btn-danger" disabled={!matches || busy}>
        {busy ? "Deleting…" : `Delete ${household.name}`}
      </button>
    </form>
  );
}
