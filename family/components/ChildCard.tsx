"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Subject } from "@/lib/types";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * The facts a clinic asks for, readable in five seconds: blood group,
 * allergies, hospital file, insurance, how she was born. Plain keys on
 * Lana's profile, editable by anyone who can edit her log.
 */
const FIELDS: { key: string; label: string; unit?: string }[] = [
  { key: "blood_group", label: "Blood group" },
  { key: "allergies", label: "Allergies" },
  { key: "hospital_number", label: "Hospital file" },
  { key: "insurance", label: "Insurance" },
  { key: "insurance_member_id", label: "Member ID" },
  { key: "insurance_note", label: "Insurance note" },
  { key: "birth_weight_kg", label: "Birth weight", unit: "kg" },
  { key: "birth_length_cm", label: "Birth length", unit: "cm" },
  { key: "birth_head_cm", label: "Head at birth", unit: "cm" },
  { key: "gestation", label: "Born at" },
  { key: "apgar", label: "Apgar" },
  { key: "newborn_screens", label: "Newborn checks" },
  { key: "hearing_test", label: "Hearing test" },
  { key: "nationality", label: "Nationality" },
];

export function ChildCard({ subject, canEdit }: { subject: Subject; canEdit: boolean }) {
  const router = useRouter();
  const p = (subject.profile ?? {}) as Record<string, string | undefined>;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, string>>(Object.fromEntries(FIELDS.map((f) => [f.key, p[f.key] ?? ""])));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const filled = FIELDS.filter((f) => p[f.key]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { data, error } = await supabaseBrowser().rpc("subject_profile_save", { p_subject_id: subject.id, p_profile: { ...(subject.profile ?? {}), ...form }, p_birth_date: null, p_name: null });
    setBusy(false);
    const res = data as { ok: boolean; message?: string } | null;
    if (error || !res?.ok) return setMsg(res?.message ?? error?.message ?? "Could not save.");
    setEditing(false);
    router.refresh();
  }

  if (editing) {
    return (
      <form onSubmit={save} className="card flex flex-col gap-3">
        <h2 className="text-xl font-bold">Edit {subject.name}'s health card</h2>
        {FIELDS.map((f) => (
          <label key={f.key} className="flex flex-col gap-1">
            <span className="font-semibold">
              {f.label}
              {f.unit ? ` (${f.unit})` : ""}
            </span>
            <input className="input" value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
          </label>
        ))}
        {msg && <p className="text-[var(--danger)]">{msg}</p>}
        <div className="grid grid-cols-2 gap-3">
          <button type="button" className="btn" onClick={() => setEditing(false)} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    );
  }

  return (
    <section className="card flex flex-col gap-2">
      <h2 className="section-title">Health card</h2>
      {filled.length === 0 ? (
        <p className="muted">Nothing on the card yet.</p>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          {filled.map((f) => (
            <div key={f.key} className="contents">
              <dt className="muted">{f.label}</dt>
              <dd className="font-semibold">
                {p[f.key]}
                {f.unit ? ` ${f.unit}` : ""}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {canEdit && (
        <button type="button" className="btn mt-2" onClick={() => setEditing(true)}>
          Edit card
        </button>
      )}
    </section>
  );
}
