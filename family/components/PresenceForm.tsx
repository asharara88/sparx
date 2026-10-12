"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Presence, PresenceState } from "@/lib/types";
import { supabaseBrowser } from "@/lib/supabase/client";

export function PresenceForm({ memberId, states, history, title = "Presence" }: { memberId: string; states: PresenceState[]; history: Presence[]; title?: string }) {
  const router = useRouter();
  const current = history[0];
  const [state, setState] = useState(current?.state_id ?? states[0]?.id ?? "");
  const [starts, setStarts] = useState(new Date().toISOString().slice(0, 10));
  const [ends, setEnds] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await supabaseBrowser().rpc("presence_set", {
      p_member_id: memberId,
      p_state_id: state,
      p_starts_on: starts || null,
      p_ends_on: ends || null,
      p_note: note || null,
    });
    setBusy(false);
    const res = data as { ok: boolean; message?: string } | null;
    setMsg(error || !res?.ok ? res?.message ?? error?.message ?? "Could not save." : "Saved.");
    setNote("");
    router.refresh();
  }

  return (
    <form onSubmit={save} className="card flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {current && (
        <p className="muted">
          Now: <b>{states.find((s) => s.id === current.state_id)?.label ?? current.state_id}</b> from {current.starts_on}
          {current.ends_on ? ` to ${current.ends_on}` : ""}
          {current.note ? ` — ${current.note}` : ""}
        </p>
      )}
      <div className="flex flex-wrap gap-2" role="group" aria-label="State">
        {states.map((s) => (
          <button key={s.id} type="button" className="chip" aria-pressed={state === s.id} onClick={() => setState(s.id)}>
            {s.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="font-semibold">From</span>
          <input className="input" type="date" value={starts} onChange={(e) => setStarts(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-semibold">Until (optional)</span>
          <input className="input" type="date" value={ends} onChange={(e) => setEnds(e.target.value)} />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="font-semibold">Note (optional)</span>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {msg && (
        <p role="status" className="font-semibold">
          {msg}
        </p>
      )}
      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save presence"}
      </button>
    </form>
  );
}
