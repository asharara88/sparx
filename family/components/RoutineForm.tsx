"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { EntryType, Routine } from "@/lib/types";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Icon } from "@/components/Icon";

/** Admin: add or change a routine. Linking an entry type logs that entry each time it is done. */
export function RoutineForm({ subjectId, routines, types }: { subjectId: string; routines: Routine[]; types: EntryType[] }) {
  const router = useRouter();
  const blank = { id: null as string | null, label: "", every_days: 7, type_id: "", last_done: "", payload: "{}" };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  function edit(r: Routine) {
    setF({ id: r.id, label: r.label, every_days: r.every_days, type_id: r.type_id ?? "", last_done: r.last_done ?? "", payload: JSON.stringify(r.payload ?? {}) });
  }
  async function save(e: React.FormEvent, deactivate = false) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    let payload: Record<string, unknown> = {};
    try {
      payload = f.payload.trim() ? (JSON.parse(f.payload) as Record<string, unknown>) : {};
    } catch {
      setBusy(false);
      return setMsg("The extra details must be JSON, like {\"kind\":\"Full change\"}.");
    }
    const { data, error } = await supabaseBrowser().rpc("routine_save", {
      p_id: f.id,
      p_subject_id: subjectId,
      p_label: f.label,
      p_every_days: Number(f.every_days),
      p_type_id: f.type_id || null,
      p_payload: payload,
      p_last_done: f.last_done || null,
      p_sort: 100,
      p_is_active: !deactivate,
    });
    setBusy(false);
    const res = data as { ok: boolean; message?: string } | null;
    if (error || !res?.ok) return setMsg(res?.message ?? error?.message ?? "Could not save.");
    setF(blank);
    router.refresh();
  }
  return (
    <div className="flex flex-col gap-4">
      <ul className="card flex flex-col">
        {routines.map((r) => (
          <li key={r.id} className="row">
            <span className="grow">
              <span className="font-semibold">{r.label}</span>
              <span className="muted text-sm"> · every {r.every_days} days{r.type_id ? ` · logs ${r.type_id.split(".")[1]}` : ""}</span>
            </span>
            <button type="button" className="btn" style={{ minHeight: 40 }} onClick={() => edit(r)}>
              Edit
            </button>
          </li>
        ))}
        {routines.length === 0 && <li className="muted py-2 text-sm">No routines yet.</li>}
      </ul>
      <form onSubmit={save} className="card flex flex-col gap-3">
        <h2 className="font-semibold">{f.id ? "Change routine" : "New routine"}</h2>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-semibold">What</span>
          <input className="input" required maxLength={80} value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="Litter full change" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-semibold">Every how many days</span>
          <input className="input" type="number" min={1} max={400} required value={f.every_days} onChange={(e) => setF({ ...f, every_days: Number(e.target.value) })} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-semibold">Also log an entry (optional)</span>
          <select className="input" value={f.type_id} onChange={(e) => setF({ ...f, type_id: e.target.value })}>
            <option value="">Nothing, just tick it off</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        {f.type_id && (
          <label className="flex flex-col gap-1">
            <span className="text-sm font-semibold">Entry details (JSON)</span>
            <input className="input font-mono text-sm" value={f.payload} onChange={(e) => setF({ ...f, payload: e.target.value })} />
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span className="text-sm font-semibold">Last done</span>
          <input className="input" type="date" value={f.last_done} onChange={(e) => setF({ ...f, last_done: e.target.value })} />
        </label>
        {msg && <p className="notice notice-danger">{msg}</p>}
        <div className="flex gap-2">
          <button type="submit" className="btn btn-primary grow" disabled={busy}>
            <Icon name="check" size={18} /> Save
          </button>
          {f.id && (
            <>
              <button type="button" className="btn" onClick={() => setF(blank)}>
                Cancel
              </button>
              <button type="button" className="btn btn-danger" disabled={busy} onClick={(e) => save(e, true)}>
                Remove
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}
