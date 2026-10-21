"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Subject } from "@/lib/types";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Icon } from "./Icon";

/**
 * The paediatrician's card: who, where, one tap to call or book, and a
 * running list of questions for the next visit. Everything is a plain key on
 * the child's profile, so anyone who can edit the log can correct it.
 */
const FIELDS: { key: string; label: string; type?: "tel" | "url" | "textarea"; hint?: string }[] = [
  { key: "doctor_name", label: "Doctor" },
  { key: "doctor_title", label: "Title" },
  { key: "doctor_hospital", label: "Hospital or clinic" },
  { key: "doctor_address", label: "Address" },
  { key: "doctor_phone", label: "Phone", type: "tel" },
  { key: "doctor_tollfree", label: "Toll-free", type: "tel" },
  { key: "doctor_whatsapp", label: "WhatsApp", type: "tel" },
  { key: "doctor_booking_url", label: "Booking link", type: "url" },
  { key: "doctor_profile_url", label: "Profile page", type: "url" },
  { key: "doctor_hours", label: "Clinic hours" },
  { key: "doctor_notes", label: "Notes", type: "textarea" },
];

const tel = (v: string) => `tel:${v.replace(/[^\d+]/g, "")}`;
const wa = (v: string) => `https://wa.me/${v.replace(/[^\d]/g, "")}`;

export function DoctorCard({ subject, canEdit }: { subject: Subject; canEdit: boolean }) {
  const router = useRouter();
  const p = (subject.profile ?? {}) as Record<string, string | undefined>;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, string>>(Object.fromEntries(FIELDS.map((f) => [f.key, p[f.key] ?? ""])));
  const [questions, setQuestions] = useState(p.doctor_questions ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save(patch: Record<string, string>) {
    setBusy(true);
    setMsg(null);
    const next = { ...(subject.profile ?? {}), ...patch };
    const { data, error } = await supabaseBrowser().rpc("subject_profile_save", { p_subject_id: subject.id, p_profile: next, p_birth_date: null, p_name: null });
    setBusy(false);
    const res = data as { ok: boolean; message?: string } | null;
    if (error || !res?.ok) {
      setMsg(res?.message ?? error?.message ?? "Could not save.");
      return false;
    }
    router.refresh();
    return true;
  }

  if (editing) {
    return (
      <form
        className="card flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await save(form)) setEditing(false);
        }}
      >
        <h2 className="text-xl font-bold">Edit the doctor's card</h2>
        {FIELDS.map((f) => (
          <label key={f.key} className="flex flex-col gap-1">
            <span className="font-semibold">{f.label}</span>
            {f.type === "textarea" ? (
              <textarea className="input" rows={3} value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
            ) : (
              <input className="input" type={f.type ?? "text"} inputMode={f.type === "tel" ? "tel" : undefined} value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
            )}
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

  const has = (k: string) => !!p[k];
  const maps = p.doctor_address ? `https://maps.google.com/?q=${encodeURIComponent(`${p.doctor_hospital ?? ""} ${p.doctor_address}`.trim())}` : null;

  return (
    <div className="flex flex-col gap-4">
      <section className="card flex flex-col gap-3">
        {has("doctor_name") ? (
          <>
            <div className="flex items-start gap-3">
              <span className="avatar shrink-0" aria-hidden style={{ width: 48, height: 48, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                <Icon name="user" size={26} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-xl font-bold">{p.doctor_name}</h2>
                {p.doctor_title && <p className="muted">{p.doctor_title}</p>}
                {p.doctor_hospital && <p className="font-medium">{p.doctor_hospital}</p>}
                {p.doctor_address && <p className="muted text-sm">{p.doctor_address}</p>}
                {p.doctor_hours && <p className="muted text-sm">{p.doctor_hours}</p>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {has("doctor_phone") && (
                <a href={tel(p.doctor_phone!)} className="btn btn-primary">
                  <Icon name="phone" size={18} /> Call
                </a>
              )}
              {has("doctor_tollfree") && (
                <a href={tel(p.doctor_tollfree!)} className="btn">
                  <Icon name="phone" size={18} /> {p.doctor_tollfree}
                </a>
              )}
              {has("doctor_whatsapp") && (
                <a href={wa(p.doctor_whatsapp!)} target="_blank" rel="noreferrer" className="btn">
                  <Icon name="whatsapp" size={18} /> WhatsApp
                </a>
              )}
              {has("doctor_booking_url") && (
                <a href={p.doctor_booking_url} target="_blank" rel="noreferrer" className="btn">
                  <Icon name="calendar" size={18} /> Book
                </a>
              )}
              {maps && (
                <a href={maps} target="_blank" rel="noreferrer" className="btn">
                  <Icon name="pin" size={18} /> Directions
                </a>
              )}
              {has("doctor_profile_url") && (
                <a href={p.doctor_profile_url} target="_blank" rel="noreferrer" className="btn">
                  <Icon name="globe" size={18} /> Profile
                </a>
              )}
            </div>
            {p.doctor_notes && <p className="muted text-sm whitespace-pre-wrap">{p.doctor_notes}</p>}
          </>
        ) : (
          <p className="muted">No doctor on the card yet.</p>
        )}
        {canEdit && (
          <button type="button" className="btn" onClick={() => setEditing(true)}>
            Edit card
          </button>
        )}
      </section>

      <section className="card flex flex-col gap-2">
        <h2 className="section-title">Questions for the next visit</h2>
        <p className="muted text-sm">Anyone can add a line. Read them out at the clinic, then clear the list.</p>
        {canEdit ? (
          <>
            <textarea className="input" rows={4} value={questions} onChange={(e) => setQuestions(e.target.value)} placeholder="One per line" aria-label="Questions for the doctor" />
            <div className="flex gap-2">
              <button type="button" className="btn btn-primary" disabled={busy || questions === (p.doctor_questions ?? "")} onClick={() => save({ doctor_questions: questions })}>
                Save
              </button>
              <button type="button" className="btn btn-ghost" disabled={busy || !questions} onClick={() => { if (window.confirm("Clear the list?")) { setQuestions(""); void save({ doctor_questions: "" }); } }}>
                Clear
              </button>
            </div>
          </>
        ) : (
          <p className="whitespace-pre-wrap">{p.doctor_questions || <span className="muted">Nothing yet.</span>}</p>
        )}
        {msg && !editing && <p className="text-[var(--danger)]">{msg}</p>}
      </section>

      <Link href="/baby/log/appointment" className="btn btn-secondary">
        <Icon name="plus" size={18} /> Log a visit
      </Link>
    </div>
  );
}
