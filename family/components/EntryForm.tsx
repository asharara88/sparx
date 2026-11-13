"use client";
import { useMemo, useState } from "react";
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
import { WhenChips } from "./WhenChips";
import { NOW, whenToIso, type When } from "@/lib/when";

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
        // A field marked fresh (a meal's first time, allergen, reaction) starts at its default every time.
        if (f.type === "choice" && !f.fresh && prev != null && (!f.option_flags?.[String(prev)] || flags[f.option_flags[String(prev)]])) keep[f.key] = prev;
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
  // The entry was saved but its photo was not: Save would make a second entry, so only Done is offered.
  const [savedAway, setSavedAway] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoText, setPhotoText] = useState("");
  const home = subject.module_id === "lana" ? "/" : `/${subject.module_id}`;
  // The child's page itself, not /lana and a redirect (the helper's entry links land here too).
  const list = subject.module_id === "lana" ? "/baby" : `/${subject.module_id}`;
  // A new entry's time is the app's When line (WhenChips), read at Save: "now" is the moment of
  // the tap, not the moment the page opened. Editing keeps the full date and time box.
  const [when, setWhen] = useState<When>(NOW);
  const [whenBad, setWhenBad] = useState(false);
  const [endWhen, setEndWhen] = useState<When>(NOW);
  const [endBad, setEndBad] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const atIso = (w: When) => whenToIso(w, Date.now(), (l) => fromLocalInput(l, tz));

  const visible = useMemo(() => t.fields.filter((f) => showField(f, payload)), [t.fields, payload]);
  const missing = visible.filter((f) => f.required && (payload[f.key] === undefined || payload[f.key] === "" || payload[f.key] === null));

  function set(key: string, value: unknown) {
    setPayload((p) => ({ ...p, [key]: value }));
  }

  async function save(extra: Record<string, unknown> = {}) {
    if (savedAway) return; // Enter in a field after the save must not log it twice
    const finalPayload = cleanPayload({ ...payload, ...extra }, visible);
    if (mode === "create" && (whenBad || (endApplies && !stillGoing && endBad))) return setMsg("Pick a time from the list, or type one like 21:30.");
    const occurredIso = mode === "create" ? atIso(when) : fromLocalInput(occurred, tz);
    const endedIso = endApplies && !stillGoing ? (mode === "create" ? atIso(endWhen) : ended ? fromLocalInput(ended, tz) : null) : null;
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
      // The entry is saved either way; a photo that did not go with it is said on this
      // screen (leaving straight away would hide the message), and Done then goes home.
      let photoMsg: string | null = null;
      if (photo && r.status === "saved") {
        try {
          const path = await uploadPhoto(photo, "entries");
          const { data, error } = await supabase.rpc("attachment_add", { p_module: subject.module_id, p_table: "care_entries", p_entity_id: r.id, p_path: path, p_caption: null, p_ocr_text: photoText || null });
          const res = data as { ok?: boolean; message?: string } | null;
          if (error || !res?.ok) photoMsg = `Saved, but the photo was not added${res?.message ? `: ${res.message}` : "."} Open the entry to try again.`;
        } catch {
          photoMsg = "Saved, but the photo did not upload. Open the entry to add it again.";
        }
      } else if (photo && r.status === "queued") {
        photoMsg = "Saved on this phone; the photo can be added once you are back online.";
      }
      setBusy(false);
      if (photoMsg) {
        setMsg(photoMsg);
        setSavedAway(true);
        return;
      }
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
    // A second tap, as in the edit sheet: no browser pop-up about "this entry".
    if (!confirmDelete) return setConfirmDelete(true);
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

  const timeLabel = endApplies ? "Started" : "When";
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (missing.length) return setMsg(`Please choose: ${missing.map((f) => f.label).join(", ")}.`);
        save();
      }}
    >
      <PageHeader back={mode === "create" ? home : list} title={mode === "create" ? t.label : `Edit ${t.label.toLowerCase()}`} />

      {/* One card, a row per question (DESIGN.md: list rows, no box per field); the time first,
          so it is set before any amount chip that saves at once. */}
      <fieldset className="card flex flex-col p-0" disabled={readOnly}>
        <div className="row flex-col px-4" role="group" aria-label={timeLabel}>
          {mode === "create" ? (
            <WhenChips value={when} onChange={setWhen} onValid={(ok) => setWhenBad(!ok)} timezone={tz} label={timeLabel} disabled={readOnly || busy} />
          ) : (
            <label className="flex flex-col gap-2">
              <span className="font-semibold">{timeLabel}</span>
              <input className="input" type="datetime-local" value={occurred} onChange={(e) => setOccurred(e.target.value)} required />
            </label>
          )}
          {endApplies && (
            <>
              <div className="segmented" role="group" aria-label="Has it ended?">
                <button type="button" aria-pressed={stillGoing} onClick={() => setStillGoing(true)}>
                  Still going
                </button>
                <button type="button" aria-pressed={!stillGoing} onClick={() => setStillGoing(false)}>
                  Ended
                </button>
              </div>
              {!stillGoing &&
                (mode === "create" ? (
                  <WhenChips value={endWhen} onChange={setEndWhen} onValid={(ok) => setEndBad(!ok)} timezone={tz} label="Ended" disabled={readOnly || busy} />
                ) : (
                  <input className="input" type="datetime-local" value={ended} onChange={(e) => setEnded(e.target.value)} aria-label="Ended" />
                ))}
            </>
          )}
        </div>

        {visible.map((f) => {
          const opts = f.type === "choice" ? (f.options ?? []).filter((o) => optionAllowed(f, o) || payload[f.key] === o) : [];
          // A question with one possible answer, already given, asks nothing ("How: Bottle").
          if (f.type === "choice" && opts.length <= 1 && payload[f.key] === opts[0]) return null;
          return (
            <div key={f.key} className="row flex-col px-4" role="group" aria-label={f.label}>
              <span className="font-semibold">{f.label}</span>
              {f.type === "choice" &&
                (opts.length <= 3 ? (
                  <div className="segmented">
                    {opts.map((o) => (
                      <button key={o} type="button" aria-pressed={payload[f.key] === o} onClick={() => set(f.key, o)}>
                        {o}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {opts.map((o) => (
                      <button key={o} type="button" className="chip" aria-pressed={payload[f.key] === o} onClick={() => set(f.key, o)}>
                        {o}
                      </button>
                    ))}
                  </div>
                ))}
              {f.type === "number" && (
                <>
                  {f.quick && (
                    <div className="flex flex-wrap gap-2">
                      {f.quick.map((q) => (
                        <button key={q} type="button" className="chip" aria-pressed={payload[f.key] === q} onClick={() => (canQuickSave ? save({ [f.key]: q }) : set(f.key, q))} disabled={busy || (canQuickSave && whenBad)}>
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
                    placeholder={f.quick ? "Other amount" : undefined}
                    value={payload[f.key] === undefined || payload[f.key] === null ? "" : String(payload[f.key])}
                    onChange={(e) => set(f.key, e.target.value === "" ? null : Number(e.target.value))}
                    aria-label={`${f.label} (type a number)`}
                  />
                  {canQuickSave && <p className="muted text-sm">Tap a number to save straight away.</p>}
                </>
              )}
              {f.type === "date" && (
                <>
                  <div className="flex flex-wrap gap-2">
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
                          const d = new Date(mode === "create" ? atIso(when) : fromLocalInput(occurred, tz));
                          d.setMonth(d.getMonth() + Number(months));
                          set(f.key, d.toISOString().slice(0, 10));
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <input className="input" type="date" value={(payload[f.key] as string) ?? ""} onChange={(e) => set(f.key, e.target.value || null)} aria-label={f.label} />
                </>
              )}
              {f.type === "text" && <input className="input" type="text" value={(payload[f.key] as string) ?? ""} onChange={(e) => set(f.key, e.target.value)} aria-label={f.label} />}
            </div>
          );
        })}
      </fieldset>

      <fieldset className="card flex flex-col p-0" disabled={readOnly}>
        {mode === "create" && (
          <div className="row flex-col px-4" role="group" aria-label="Photo">
            <span className="font-semibold">
              Photo <span className="muted font-normal">(optional)</span>
            </span>
            <PhotoPicker file={photo} onFile={setPhoto} withText onText={setPhotoText} disabled={busy} />
            {photoText && <p className="muted max-h-24 overflow-auto whitespace-pre-wrap text-sm">{photoText}</p>}
          </div>
        )}
        <label className="row flex-col px-4">
          <span className="font-semibold">
            Note {t.key === "note" ? "" : <span className="muted font-normal">(optional)</span>}
          </span>
          <textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} required={t.key === "note"} />
        </label>
      </fieldset>
      {mode === "edit" && props.entryId && <Attachments module={subject.module_id} table="care_entries" entityId={props.entryId} folder="entries" canAdd={!readOnly} />}

      {msg && (
        <p role="alert" className="notice notice-danger">
          {msg}
        </p>
      )}

      {/* Deleting is a word, away from Save, and asks with a second tap (DESIGN.md rule 8). */}
      {mode === "edit" && props.canDelete && (
        <button type="button" className="self-end px-2 font-bold text-[var(--danger)]" onClick={() => void remove()} disabled={busy}>
          {confirmDelete ? "Tap again to delete" : `Delete this ${t.label.toLowerCase()}`}
        </button>
      )}
      {/* The screen's one main action, at the thumb. */}
      {savedAway ? (
        <div className="bottom-action">
          <button
            type="button"
            className="btn btn-primary btn-lg w-full"
            onClick={() => {
              router.push(home);
              router.refresh();
            }}
          >
            Done
          </button>
        </div>
      ) : (
        !readOnly && (
          <div className="bottom-action">
            <button type="submit" className="btn btn-primary btn-lg w-full" disabled={busy || (mode === "create" && whenBad)}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        )
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
