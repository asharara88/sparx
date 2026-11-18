"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Subject } from "@/lib/types";
import { supabaseBrowser } from "@/lib/supabase/client";
import { sexOf } from "@/lib/names";
import { ageWords } from "@/lib/norms";

/**
 * The facts a clinic asks for, readable in five seconds: blood group,
 * allergies, hospital file, insurance, how the child was born. Plain keys on
 * the child's profile, editable by anyone who can edit the log. An admin's form
 * begins with the child's name, birth date and girl or boy (X2): naps, vaccines and
 * what is usual go by the age, so a changed date asks once before it is saved.
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

export function ChildCard({ subject, canEdit, isAdmin, today }: { subject: Subject; canEdit: boolean; /** Only an admin changes the name, birth date and girl or boy. */ isAdmin: boolean; /** The home's today: the latest birth date, and the age read back. */ today: string }) {
  const router = useRouter();
  const p = (subject.profile ?? {}) as Record<string, string | undefined>;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, string>>(Object.fromEntries(FIELDS.map((f) => [f.key, p[f.key] ?? ""])));
  const recorded = sexOf(p.sex) === "girl" ? "Girl" : sexOf(p.sex) === "boy" ? "Boy" : null;
  const [name, setName] = useState(subject.name);
  const [born, setBorn] = useState(subject.birth_date ?? "");
  const [sex, setSex] = useState<"Girl" | "Boy" | null>(recorded);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const filled = FIELDS.filter((f) => p[f.key]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    // The old profile always goes back whole; the sex key is written only when it was changed.
    const profile: Record<string, unknown> = { ...(subject.profile ?? {}), ...form };
    if (isAdmin && sex !== recorded) {
      if (sex) profile.sex = sex;
      else delete profile.sex;
    }
    const newName = isAdmin && name.trim() && name.trim() !== subject.name ? name.trim() : null;
    const newBorn = isAdmin && born && born !== subject.birth_date ? born : null;
    if (newBorn && !window.confirm(`${newName ?? subject.name} will be ${ageWords(newBorn, today)} old. Everything that goes by age changes. Save?`)) return;
    setBusy(true);
    setMsg(null);
    const { data, error } = await supabaseBrowser().rpc("subject_profile_save", { p_subject_id: subject.id, p_profile: profile, p_birth_date: newBorn, p_name: newName });
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
        {isAdmin && (
          <>
            <label className="flex flex-col gap-1">
              <span className="font-semibold">Name</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="off" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-semibold">Born</span>
              <input className="input" type="date" value={born} max={today} required={!!subject.birth_date} onChange={(e) => setBorn(e.target.value)} />
              {born && born <= today && <span className="muted text-sm">= {ageWords(born, today)} old</span>}
            </label>
            <div className="flex flex-col gap-1">
              <span className="font-semibold">Girl or boy</span>
              <div className="flex gap-2" role="group" aria-label="Girl or boy">
                {(["Girl", "Boy"] as const).map((x) => (
                  <button key={x} type="button" aria-pressed={sex === x} className="chip" onClick={() => setSex(sex === x ? null : x)}>
                    {x}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
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
          Edit health card
        </button>
      )}
    </section>
  );
}
