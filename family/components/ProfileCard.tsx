"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DueItem, Subject } from "@/lib/types";
import { can } from "@/lib/types";
import { useMe } from "@/lib/me-context";
import { fmtDate } from "@/lib/time";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Attachments } from "./Attachments";

/**
 * The card you pull up at the vet: readable in five seconds, phone numbers tap to call.
 * Fields are plain keys in care_subjects.profile so admins can add more later.
 */
const FIELDS: { key: string; label: string; type?: "text" | "tel" | "bool" }[] = [
  { key: "clinic", label: "Clinic" },
  { key: "clinic_phone", label: "Clinic phone", type: "tel" },
  { key: "clinic_address", label: "Clinic address" },
  { key: "microchip", label: "Microchip" },
  { key: "spayed", label: "Spayed", type: "bool" },
  { key: "indoor", label: "Indoor cat", type: "bool" },
  { key: "sex", label: "Sex" },
  { key: "colour", label: "Colour" },
  { key: "age_note", label: "Age" },
  { key: "food", label: "Food" },
  { key: "insurance", label: "Insurance" },
  { key: "allergies", label: "Allergies / conditions" },
  { key: "emergency_phone", label: "Emergency vet", type: "tel" },
  { key: "notes", label: "Notes" },
];

export function ProfileCard({ subject, due, timezone }: { subject: Subject; due: DueItem[]; timezone: string }) {
  const me = useMe();
  const router = useRouter();
  const canEdit = can(me, subject.module_id, "edit");
  const [editing, setEditing] = useState(false);
  const [profile, setProfile] = useState<Record<string, unknown>>(subject.profile ?? {});
  const [birth, setBirth] = useState(subject.birth_date ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const p = subject.profile ?? {};
  const show = (k: string) => p[k] !== undefined && p[k] !== null && p[k] !== "";

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { data, error } = await supabaseBrowser().rpc("subject_profile_save", { p_subject_id: subject.id, p_profile: profile, p_birth_date: birth || null, p_name: null });
    setBusy(false);
    const res = data as { ok: boolean; message?: string } | null;
    if (error || !res?.ok) return setMsg(res?.message ?? error?.message ?? "Could not save.");
    setEditing(false);
    router.refresh();
  }

  if (editing) {
    return (
      <form onSubmit={save} className="card flex flex-col gap-3">
        <h2 className="text-xl font-bold">Edit {subject.name}'s card</h2>
        <label className="flex flex-col gap-1">
          <span className="font-semibold">Date of birth (or best guess)</span>
          <input className="input" type="date" value={birth} onChange={(e) => setBirth(e.target.value)} />
        </label>
        {FIELDS.map((f) =>
          f.type === "bool" ? (
            <label key={f.key} className="flex items-center gap-3">
              <input type="checkbox" className="h-7 w-7" checked={!!profile[f.key]} onChange={(e) => setProfile({ ...profile, [f.key]: e.target.checked })} />
              <span className="font-semibold">{f.label}</span>
            </label>
          ) : (
            <label key={f.key} className="flex flex-col gap-1">
              <span className="font-semibold">{f.label}</span>
              <input className="input" type={f.type === "tel" ? "tel" : "text"} value={(profile[f.key] as string) ?? ""} onChange={(e) => setProfile({ ...profile, [f.key]: e.target.value })} />
            </label>
          ),
        )}
        {msg && <p className="text-red-800">{msg}</p>}
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
    <div className="flex flex-col gap-4">
      <section className="card">
        <h1 className="text-3xl font-bold">
          {subject.name}
          {subject.kind === "pet" ? " 🐈" : ""}
        </h1>
        <p className="muted">
          {[p.sex, p.colour, p.age_note ?? (subject.birth_date ? `born ${fmtDate(subject.birth_date, timezone)}` : null), p.spayed ? "spayed" : null, p.indoor ? "indoor" : null].filter(Boolean).join(" · ")}
        </p>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-lg">
          {FIELDS.filter((f) => f.type !== "bool" && !["sex", "colour", "age_note"].includes(f.key) && show(f.key)).map((f) => (
            <div key={f.key} className="contents">
              <dt className="muted">{f.label}</dt>
              <dd className="font-semibold">
                {f.type === "tel" ? (
                  <a href={`tel:${String(p[f.key]).replace(/\s/g, "")}`} className="underline">
                    {String(p[f.key])}
                  </a>
                ) : (
                  String(p[f.key])
                )}
              </dd>
            </div>
          ))}
        </dl>
        {canEdit && (
          <button type="button" className="btn mt-4" onClick={() => setEditing(true)}>
            Edit card
          </button>
        )}
      </section>

      <section className="card">
        <h2 className="text-xl font-bold">Treatments</h2>
        {due.filter((d) => d.kind === "treatment").length === 0 ? (
          <p className="muted mt-1">No vaccination, deworming or flea treatment logged yet. Log one with its next due date and it will show here.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {due
              .filter((d) => d.kind === "treatment")
              .map((d) => (
                <li key={d.label + d.due_at} className={d.overdue ? "font-semibold text-[var(--warn)]" : ""}>
                  💉 {d.label} · {d.overdue ? "was due" : "due"} {fmtDate(d.due_at, timezone)}
                </li>
              ))}
          </ul>
        )}
      </section>

      <Attachments module={subject.module_id} table="care_subjects" entityId={subject.id} folder="subjects" canAdd={canEdit} withText={false} title="Photos (vaccination book, insurance card…)" />
    </div>
  );
}
