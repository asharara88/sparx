"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { EntryRow, EntryType, FieldDef } from "@/lib/types";
import { useMe } from "@/lib/me-context";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtDuration, fromLocalInput, toLocalInput } from "@/lib/time";
import { NAP_LENGTHS } from "@/lib/backlog";
import { Sheet } from "./Sheet";

const FEED_LENGTHS = [5, 10, 15, 20, 30] as const;

/**
 * Tap an entry, change it in place (DESIGN.md, "Edit an entry"; Huckleberry's edit path):
 * when it started (the phone's own time picker), when it ended as clock-time chips, its
 * choices and amounts as chips, Save, and Delete in the same sheet. A note or a photo is
 * on the full form behind "All details".
 */
export function EntrySheet({ entry, type, timezone, canEdit, canDelete, onClose }: { entry: EntryRow; type: EntryType | undefined; timezone: string; canEdit: boolean; canDelete: boolean; onClose: () => void }) {
  const me = useMe();
  const router = useRouter();
  const flags = me.member as unknown as Record<string, unknown>;
  const [start, setStart] = useState(toLocalInput(entry.occurred_at, timezone));
  const [end, setEnd] = useState(entry.ended_at ? toLocalInput(entry.ended_at, timezone) : "");
  const [payload, setPayload] = useState<Record<string, unknown>>(entry.payload ?? {});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const startMs = Date.parse(fromLocalInput(start, timezone));
  const endMs = end ? Date.parse(fromLocalInput(end, timezone)) : null;
  const lastedMin = endMs != null ? Math.round((endMs - startMs) / 60_000) : null;
  // An end applies to timers (a sleep, a breastfeed), never to a bottle logged with its end at its start.
  const timed = !!type?.has_end && (!!entry.ended_at ? Date.parse(entry.ended_at) - Date.parse(entry.occurred_at) >= 60_000 : true) && payload.method !== "Bottle";
  const lengths = entry.type_id === "lana.sleep" ? NAP_LENGTHS : FEED_LENGTHS;
  const endChoices = lengths.map((m) => toLocalInput(new Date(startMs + m * 60_000).toISOString(), timezone)).filter((l) => Date.parse(fromLocalInput(l, timezone)) <= Date.now());
  const visible = (type?.fields ?? []).filter((f) => !f.show_if || Object.entries(f.show_if).every(([k, v]) => payload[k] === v));
  const chipFields = visible.filter((f) => (f.type === "choice" && f.options?.length) || (f.type === "number" && f.quick?.length));
  const allowed = (f: FieldDef, o: string) => !f.option_flags?.[o] || !!flags[f.option_flags[o]];
  const noun = entry.type_label.toLowerCase();

  async function save() {
    if (endMs != null && endMs < startMs) return setMsg("It ends before it starts. Pick a later end.");
    setBusy(true);
    setMsg(null);
    const { data, error } = await supabaseBrowser().rpc("care_entry_update", {
      p_id: entry.id,
      p_occurred_at: new Date(startMs).toISOString(),
      // A bottle is logged with its end at its start: moving it moves both.
      p_ended_at: timed ? (endMs != null ? new Date(endMs).toISOString() : null) : entry.ended_at ? new Date(startMs).toISOString() : null,
      p_payload: payload,
      p_note: entry.note,
    });
    setBusy(false);
    const res = data as { ok: boolean; message?: string } | null;
    if (error || !res?.ok) return setMsg(res?.message ?? error?.message ?? "Could not save.");
    onClose();
    router.refresh();
  }

  async function remove() {
    // Destroying is a word and a second tap, never a pop-up (DESIGN.md, rule 8).
    if (!confirmDelete) return setConfirmDelete(true);
    setBusy(true);
    const { data } = await supabaseBrowser().rpc("care_entry_delete", { p_id: entry.id });
    setBusy(false);
    const res = data as { ok: boolean; message?: string } | null;
    if (!res?.ok) return setMsg(res?.message ?? "Could not delete.");
    onClose();
    router.refresh();
  }

  return (
    <Sheet title={`${entry.type_label}${timed && lastedMin && lastedMin > 0 ? ` · ${fmtDuration(lastedMin)}` : ""}`} onClose={onClose}>
      <p className="muted -mt-2 text-sm">Logged by {entry.attributed_name ?? entry.logged_by_name ?? "someone"}</p>
      <div className="card flex flex-col p-0">
        <label className="row px-4">
          <span className="flex-1 font-semibold">{timed ? (entry.type_id === "lana.sleep" ? "Fell asleep" : "Started") : "At"}</span>
          <input className="time-field" type="datetime-local" value={start} max={toLocalInput(new Date().toISOString(), timezone)} disabled={!canEdit} onChange={(e) => e.target.value && setStart(e.target.value)} />
        </label>
        {timed && (
          <div className="row flex-col items-stretch px-4">
            <span className="font-semibold">{entry.type_id === "lana.sleep" ? "Woke up" : "Ended"}</span>
            <div className="grid grid-cols-4 gap-2" role="group" aria-label="Ended">
              {endChoices.map((l) => (
                <button key={l} type="button" className="chip px-0 tabular-nums" aria-pressed={end === l} disabled={!canEdit} onClick={() => setEnd(l)}>
                  {l.slice(11)}
                </button>
              ))}
            </div>
            <input className="time-field self-start" type="datetime-local" value={end} max={toLocalInput(new Date().toISOString(), timezone)} disabled={!canEdit} aria-label="Ended at" onChange={(e) => setEnd(e.target.value)} />
          </div>
        )}
        {chipFields.map((f) => (
          <div key={f.key} className="row flex-col items-stretch px-4">
            <span className="font-semibold">{f.label}</span>
            <div className="flex flex-wrap gap-2" role="group" aria-label={f.label}>
              {f.type === "choice"
                ? f.options!.filter((o) => allowed(f, o) || payload[f.key] === o).map((o) => (
                    <button key={o} type="button" className="chip" aria-pressed={payload[f.key] === o} disabled={!canEdit} onClick={() => setPayload({ ...payload, [f.key]: o })}>
                      {o}
                    </button>
                  ))
                : [...new Set([...(f.quick ?? []), ...(typeof payload[f.key] === "number" ? [payload[f.key] as number] : [])])].sort((a, b) => a - b).map((n) => (
                    <button key={n} type="button" className="chip" aria-pressed={payload[f.key] === n} disabled={!canEdit} onClick={() => setPayload({ ...payload, [f.key]: n })}>
                      {n}
                      {f.key.endsWith("_ml") ? " ml" : ""}
                    </button>
                  ))}
            </div>
          </div>
        ))}
      </div>
      {msg && <p className="text-sm text-[var(--danger)]">{msg}</p>}
      {canEdit && (
        <button type="button" className="btn btn-primary btn-lg" disabled={busy} onClick={() => void save()}>
          Save
        </button>
      )}
      <div className="flex items-center justify-between gap-2">
        <Link href={`/baby/entry/${entry.id}`} className="flex min-h-[44px] items-center text-sm font-semibold">
          All details ›
        </Link>
        {canDelete && (
          <button type="button" className="min-h-[44px] px-2 font-bold text-[var(--danger)]" disabled={busy} onClick={() => void remove()}>
            {confirmDelete ? "Tap again to delete" : `Delete this ${noun}`}
          </button>
        )}
      </div>
    </Sheet>
  );
}
