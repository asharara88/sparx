"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Household } from "@/lib/types";
import { supabaseBrowser } from "@/lib/supabase/client";

/** Admin: the household's name, notes for the assistant, and the daily pumped-milk target. */
export function HouseholdForm({ household }: { household: Household }) {
  const router = useRouter();
  const [name, setName] = useState(household.name);
  const [notes, setNotes] = useState(household.notes ?? "");
  const [target, setTarget] = useState(String(household.milk_target_ml ?? 400));
  const [interval, setIntervalMin] = useState(String(household.bottle_interval_min ?? 120));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { data, error } = await supabaseBrowser().rpc("household_save", { p_name: name, p_notes: notes || null, p_milk_target_ml: Math.max(0, Math.round(Number(target) || 0)), p_bottle_interval_min: Math.min(600, Math.max(30, Math.round(Number(interval) || 120))) });
    setBusy(false);
    const res = data as { ok: boolean; message?: string } | null;
    if (error || !res?.ok) return setMsg(res?.message ?? error?.message ?? "Could not save.");
    setMsg("Saved.");
    router.refresh();
  }

  return (
    <form onSubmit={save} className="card flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Household</h2>
      <label className="flex flex-col gap-1">
        <span className="font-semibold">Name</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-semibold">Pumped milk to have in the fridge each day (ml)</span>
        <input className="input" type="number" inputMode="numeric" min={0} step={10} value={target} onChange={(e) => setTarget(e.target.value)} />
        <span className="muted text-sm">The home screen and the morning brief compare the day's pumping with this.</span>
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-semibold">Notes for the assistant</span>
        <textarea className="input" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Things the family knows that the log does not show." />
      </label>
      {msg && (
        <p role="status" className={`notice ${msg === "Saved." ? "notice-ok" : "notice-danger"}`}>
          {msg}
        </p>
      )}
      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
