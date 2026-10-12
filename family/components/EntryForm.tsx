"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { EntryType, FieldDef, Subject } from "@/lib/types";
import { fromLocalInput, toLocalInput } from "@/lib/time";
import { supabaseBrowser } from "@/lib/supabase/client";
import { newClientId, sendOrQueue } from "@/lib/offline";
import { useMe } from "@/lib/me-context";
import { uploadPhoto } from "@/lib/photos";
import { PhotoPicker } from "./PhotoPicker";
import { Attachments } from "./Attachments";
import { PageHeader } from "@/components/PageHeader";

interface Initial {
  payload: Record<string, unknown>;
  occurred_at: string;
  ended_at: string | null;
  note: string;
}

export function EntryForm(props: {
  mode: "create" | "edit";
  entryId?: string;
  subject: Subject;
  entryType: EntryType;
  timezone: string;
  initial: Initial;
  canEdit?: boolean;
  canDelete?: boolean;
}) {
  const { mode, subject, entryType: t, timezone: tz, initial } = props;
  const router = useRouter();
  const me = useMe();
  const flags = me.member as unknown as Record<string, unknown>;
  const optionAllowed = (f: FieldDef, o: string) => !f.option_flags?.[o] || !!flags[f.option_flags[o]];
  const readOnly = mode === "edit" && !props.canEdit;
  const [payload, setPayload] = useState<Record<string, unknown>>(() => {
    // In create mode, only carry over choice answers (how / where), not amounts.
    if (mode === "create") {
      const keep: Record<string, unknown> = {};
      for (const f of t.fields) {
        if (f.default !== undefined) keep[f.key] = f.default;
        const prev = initial.payload[f.key];
        if (f.type === "choice" && prev != null && (!f.option_flags?.[String(prev)] || flags[f.option_flags[String(prev)]])) keep[f.key] = prev;
      }
      return keep;
    }
    return initial.payload;
  });
  const [occurred, setOccurred] = useState(toLocalInput(initial.occurred_at, tz));
  const [ended, setEnded] = useState(initial.ended_at ? toLocalInput(initial.ended_at, tz) : "");
  const [stillGoing, setStillGoing] = useState(t.has_end && mode === "create" ? true : !initial.ended_at && t.has_end);
  // Some types only have an end time for certain answers (e.g. a breastfeed, not a bottle).
  const endApplies = t.has_end && (!t.settings?.end_if || Object.entries(t.settings.end_if).every(([k, v]) => payload[k] === v));
  const [note, setNote] = useState(initial.note);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoText, setPhotoText] = useState("");
  const home = subject.module_id === "lana" ? "/" : `/${subject.module_id}`;
  const list = `/${subject.module_id}`;

  const visible = useMemo(() => t.fields.filter((f) => showField(f, payload)), [t.fields, payload]);
  const missing = visible.filter((f) => f.required && (payload[f.key] === undefined || payload[f.key] === "" || payload[f.key] === null));

  function set(key: string, value: unknown) {
    setPayload((p) => ({ ...p, [key]: value }));
  }

  async function save(extra: Record<string, unknown> = {}) {
    const finalPayload = cleanPayload({ ...payload, ...extra }, visible);
    const occurredIso = fromLocalInput(occurred, tz);
    const endedIso = endApplies && !stillGoing && ended ? fromLocalInput(ended, tz) : null;
    if (endedIso && new Date(endedIso) < new Date(occurredIso)) {
      setMsg("The end time is before the start time.");
      return;
    }
    setBusy(true);
    setMsg(null);
    const supabase = supabaseBrowser();
    if (mode === "create") {
      const r = await sendOrQueue(supabase, {
        client_id: newClientId(),
        subject_id: subject.id,
        type_id: t.id,
        occurred_at: occurredIso,
        ended_at: endedIso,
        payload: finalPayload,
        note: note.trim() || null,
      });
      if (r.status === "error") {
        setBusy(false);
        return setMsg(r.message);
      }
      if (photo && r.status === "saved") {
        try {
          const path = await uploadPhoto(photo, "entries");
          await supabase.rpc("attachment_add", { p_module: subject.module_id, p_table: "care_entries", p_entity_id: r.id, p_path: path, p_caption: null, p_ocr_text: photoText || null });
        } catch {
          setMsg("Saved, but the photo did not upload. Open the entry to add it again.");
        }
      } else if (photo && r.status === "queued") {
        setMsg("Saved on this phone; the photo can be added once you are back online.");
      }
      setBusy(false);
      router.push(home);
      router.refresh();
      return;
    }
    const { data, error } = await supabase.rpc("care_entry_update", {
      p_id: props.entryId,
      p_occurred_at: occurredIso,
      p_ended_at: endedIso,
      p_payload: finalPayload,
      p_note: note.trim() || null,
    });
    setBusy(false);
    const res = data as { ok: boolean; message?: string } | null;
    if (error || !res?.ok) return setMsg(res?.message ?? error?.message ?? "Could not save.");
    router.push(list);
    router.refresh();
  }

  async function remove() {
    if (!confirm("Delete this entry?")) return;
    setBusy(true);
    const { data } = await supabaseBrowser().rpc("care_entry_delete", { p_id: props.entryId });
    setBusy(false);
    const res = data as { ok: boolean; message?: string } | null;
    if (!res?.ok) return setMsg(res?.message ?? "Could not delete.");
    router.push(list);
    router.refresh();
  }

  // One-tap quick save: when the only thing left to pick is a number with quick values.
  const quickField = visible.find((f) => f.type === "number" && f.quick?.length);
  const canQuickSave = mode === "create" && quickField && missing.every((f) => f.key === quickField.key);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (missing.length) return setMsg(`Please choose: ${missing.map((f) => f.label).join(", ")}.`);
        save();
      }}
    >
      <PageHeader back={mode === "create" ? home : list} title={<><span aria-hidden>{t.icon} </span>
          {mode === "create" ? t.label : `Edit ${t.label.toLowerCase()}`}</>} />

      {visible.map((f) => (
        <fieldset key={f.key} className="card" disabled={readOnly}>
          <legend className="px-1 font-semibold">{f.label}</legend>
          {f.type === "choice" && (
            <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={f.label}>
              {f.options?.filter((o) => optionAllowed(f, o)).map((o) => (
                <button key={o} type="button" className="chip" aria-pressed={payload[f.key] === o} onClick={() => set(f.key, o)}>
                  {o}
                </button>
              ))}
            </div>
          )}
          {f.type === "number" && (
            <div className="mt-2">
              {f.quick && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {f.quick.map((q) => (
                    <button
                      key={q}
                      type="button"
                      className="chip"
                      aria-pressed={payload[f.key] === q}
                      onClick={() => (canQuickSave ? save({ [f.key]: q }) : set(f.key, q))}
                      disabled={busy}
                    >
                      {q}
                      
                    </button>
                  ))}
                </div>
              )}
              <input
                className="input"
                type="number"
                inputMode="decimal"
                step={f.step ?? 1}
                value={payload[f.key] === undefined || payload[f.key] === null ? "" : String(payload[f.key])}
                onChange={(e) => set(f.key, e.target.value === "" ? null : Number(e.target.value))}
                aria-label={`${f.label} (type a number)`}
              />
              {canQuickSave && <p className="muted mt-1 text-sm">Tap a number to save straight away.</p>}
            </div>
          )}
          {f.type === "date" && (
            <div className="mt-2">
              <div className="mb-2 flex flex-wrap gap-2">
                {[
                  ["In 1 month", 1],
                  ["In 3 months", 3],
                  ["In 6 months", 6],
                  ["In 1 year", 12],
                ].map(([label, months]) => (
                  <button
                    key={String(label)}
                    type="button"
                    className="chip"
                    onClick={() => {
                      const d = new Date(occurred || Date.now());
                      d.setMonth(d.getMonth() + Number(months));
                      set(f.key, d.toISOString().slice(0, 10));
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <input className="input" type="date" value={(payload[f.key] as string) ?? ""} onChange={(e) => set(f.key, e.target.value || null)} aria-label={f.label} />
            </div>
          )}
          {f.type === "text" && (
            <input
              className="input mt-2"
              type="text"
              value={(payload[f.key] as string) ?? ""}
              onChange={(e) => set(f.key, e.target.value)}
              aria-label={f.label}
            />
          )}
        </fieldset>
      ))}

      <fieldset className="card" disabled={readOnly}>
        <legend className="px-1 font-semibold">{endApplies ? "Start time" : "Time"}</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className="chip" onClick={() => setOccurred(toLocalInput(new Date().toISOString(), tz))}>
            Now
          </button>
          {[15, 30, 60].map((m) => (
            <button
              key={m}
              type="button"
              className="chip"
              onClick={() => setOccurred(toLocalInput(new Date(Date.now() - m * 60000).toISOString(), tz))}
            >
              {m} min ago
            </button>
          ))}
        </div>
        <input className="input mt-2" type="datetime-local" value={occurred} onChange={(e) => setOccurred(e.target.value)} required />
        {endApplies && (
          <div className="mt-3">
            <label className="flex items-center gap-3">
              <input type="checkbox" className="h-7 w-7" checked={stillGoing} onChange={(e) => setStillGoing(e.target.checked)} />
              <span className="font-semibold">Still going (no end time yet)</span>
            </label>
            {!stillGoing && (
              <>
                <p className="mt-2 font-semibold">End time</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  <button type="button" className="chip" onClick={() => setEnded(toLocalInput(new Date().toISOString(), tz))}>
                    Now
                  </button>
                </div>
                <input className="input mt-2" type="datetime-local" value={ended} onChange={(e) => setEnded(e.target.value)} />
              </>
            )}
          </div>
        )}
      </fieldset>

      {mode === "create" && (
        <fieldset className="card" disabled={readOnly}>
          <legend className="px-1 font-semibold">Photo (optional)</legend>
          <div className="mt-2">
            <PhotoPicker file={photo} onFile={setPhoto} withText onText={setPhotoText} disabled={busy} />
            {photoText && <p className="muted mt-2 max-h-24 overflow-auto whitespace-pre-wrap text-sm">{photoText}</p>}
          </div>
        </fieldset>
      )}
      {mode === "edit" && props.entryId && (
        <Attachments module={subject.module_id} table="care_entries" entityId={props.entryId} folder="entries" canAdd={!readOnly} />
      )}

      <fieldset className="card" disabled={readOnly}>
        <legend className="px-1 font-semibold">Note {t.key === "note" ? "" : "(optional)"}</legend>
        <textarea className="input mt-2" rows={3} value={note} onChange={(e) => setNote(e.target.value)} required={t.key === "note"} />
      </fieldset>

      {msg && (
        <p role="alert" className="notice notice-danger">
          {msg}
        </p>
      )}

      {!readOnly && (
        <button type="submit" className="btn btn-primary min-h-[64px] text-xl" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
      )}
      {mode === "edit" && props.canDelete && (
        <button type="button" className="btn btn-danger" onClick={remove} disabled={busy}>
          Delete
        </button>
      )}
    </form>
  );
}

function showField(f: FieldDef, payload: Record<string, unknown>): boolean {
  if (!f.show_if) return true;
  return Object.entries(f.show_if).every(([k, v]) => payload[k] === v);
}

function cleanPayload(p: Record<string, unknown>, visible: FieldDef[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of visible) {
    const v = p[f.key];
    if (v !== undefined && v !== null && v !== "") out[f.key] = v;
  }
  return out;
}
