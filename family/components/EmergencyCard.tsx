"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Subject } from "@/lib/types";
import { supabaseBrowser } from "@/lib/supabase/client";
import { possessive } from "@/lib/names";
import { ambulanceOf } from "@/lib/emergency";
import { Icon } from "./Icon";

// {n} is the ambulance number from the profile; {child} the child's name in that language.
const T = {
  call: { en: "Call {n} ambulance", ar: "اتصل بالإسعاف {n}", ru: "Скорая {n}" },
  noNumber: { en: "Add the ambulance number", ar: "أضف رقم الإسعاف", ru: "Добавьте номер скорой" },
  doctor: { en: "{child's} doctor", ar: "دكتور {child}", ru: "Врач {child}" },
  hospital: { en: "Hospital", ar: "المستشفى", ru: "Больница" },
  papa: { en: "Papa", ar: "بابا", ru: "Папа" },
  mama: { en: "Mama", ar: "ماما", ru: "Мама" },
  blood: { en: "Blood group", ar: "فصيلة الدم", ru: "Группа крови" },
  allergies: { en: "Allergies", ar: "حساسية", ru: "Аллергия" },
  notes: { en: "Medical notes", ar: "ملاحظات طبية", ru: "Заметки" },
  file: { en: "Hospital file", ar: "رقم الملف", ru: "Номер карты" },
  empty: { en: "Not added yet", ar: "لسه مش مضاف", ru: "Ещё не добавлено" },
  missing: { en: "Not added yet:", ar: "لسه مش مضاف:", ru: "Ещё не добавлено:" },
  map: { en: "Map", ar: "الخريطة", ru: "Карта" },
  edit: { en: "Edit details", ar: "تعديل البيانات", ru: "Изменить" },
};
type Lang = keyof typeof T.call;
const FIELDS: [string, string][] = [
  ["emergency_ambulance", "Ambulance number"],
  ["emergency_papa_phone", "Papa's phone"],
  ["emergency_mama_phone", "Mama's phone"],
  ["emergency_hospital", "Nearest hospital"],
  ["emergency_hospital_map", "Hospital map link"],
  ["emergency_notes", "Medical notes"],
];
const tel = (n: string) => `tel:${n.replace(/[^\d+]/g, "")}`;

/** Ambulance, doctor, parents, hospital, blood group and allergies, one screen, big buttons. */
export function EmergencyCard({ subject, lang, canEdit }: { subject: Subject; lang: Lang; canEdit: boolean }) {
  const router = useRouter();
  const p = (subject.profile ?? {}) as Record<string, string | undefined>;
  // No number assumed: a home that has not given one is asked for it, not told to dial 998.
  const ambulance = ambulanceOf(subject.profile) ?? "";
  // The child's name in the member's language when the household gave one, else the main name.
  const childName = ((subject.profile?.names as Record<string, string> | undefined)?.[lang]) || subject.name;
  const t = (k: keyof typeof T) => T[k][lang].replace("{n}", ambulance).replace("{child's}", possessive(childName)).replace("{child}", childName);
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState<Record<string, string>>(Object.fromEntries(FIELDS.map(([k]) => [k, p[k] ?? ""])));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { data, error } = await supabaseBrowser().rpc("subject_profile_save", { p_subject_id: subject.id, p_profile: { ...(subject.profile ?? {}), ...form }, p_birth_date: null, p_name: null });
    setBusy(false);
    const res = data as { ok: boolean; message?: string } | null;
    if (error || !res?.ok) return setMsg(res?.message ?? error?.message ?? "Could not save.");
    setEdit(false);
    router.refresh();
  }

  const CallRow = ({ label, name, phone }: { label: string; name?: string; phone?: string }) => (
    <div className="card flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="muted text-sm font-semibold">{label}</p>
        {name || phone ? <p className="truncate text-xl font-bold">{name || phone}</p> : <p className="muted">{t("empty")}</p>}
        {name && phone && (
          <p className="muted" dir="ltr">
            {phone}
          </p>
        )}
      </div>
      {phone && (
        <a href={tel(phone)} aria-label={`Call ${label}`} className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[var(--ok)] text-white">
          <Icon name="phone" size={24} />
        </a>
      )}
    </div>
  );

  const missing = [
    !(p.doctor_name || p.doctor_tollfree || p.doctor_phone) && t("doctor"),
    !p.emergency_papa_phone && t("papa"),
    !p.emergency_mama_phone && t("mama"),
    !(p.emergency_hospital || p.doctor_hospital || p.emergency_hospital_map || p.doctor_address) && t("hospital"),
    !p.blood_group && t("blood"),
    !p.allergies && t("allergies"),
  ].filter(Boolean) as string[];
  return (
    <div dir={lang === "ar" ? "rtl" : "ltr"} className="flex flex-col gap-3">
      {ambulance ? (
        <a href={tel(ambulance)} className="flex items-center justify-center gap-3 rounded-3xl bg-[var(--danger)] p-6 text-2xl font-bold text-white shadow-[var(--shadow)] active:scale-[0.98]">
          <Icon name="phone" size={30} /> {t("call")}
        </a>
      ) : (
        <p className="flex items-center justify-center gap-3 rounded-3xl border-2 border-[var(--danger)] p-6 text-center text-xl font-bold text-[var(--danger)]">
          <Icon name="phone" size={26} /> {t("noNumber")}
        </p>
      )}
      {/* Only what is filled in gets a box; what is missing is one quiet line (Mido, 9 November:
          a stack of "Not filled in yet" boxes in bold read as data). */}
      {(p.doctor_name || p.doctor_tollfree || p.doctor_phone) && <CallRow label={t("doctor")} name={p.doctor_name} phone={p.doctor_tollfree || p.doctor_phone} />}
      {p.emergency_papa_phone && <CallRow label={t("papa")} phone={p.emergency_papa_phone} />}
      {p.emergency_mama_phone && <CallRow label={t("mama")} phone={p.emergency_mama_phone} />}
      {(p.emergency_hospital || p.doctor_hospital || p.emergency_hospital_map || p.doctor_address) && (
        <div className="card flex flex-col gap-1">
          <p className="muted text-sm font-semibold">{t("hospital")}</p>
          {(p.emergency_hospital || p.doctor_hospital) && <p className="text-xl font-bold">{p.emergency_hospital || p.doctor_hospital}</p>}
          {(p.emergency_hospital_map || p.doctor_address) && (
            <a href={p.emergency_hospital_map || `https://maps.google.com/?q=${encodeURIComponent(p.doctor_address ?? "")}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-[var(--accent)] underline">
              <Icon name="pin" size={16} /> {t("map")}
            </a>
          )}
        </div>
      )}
      {(p.blood_group || p.allergies || p.hospital_number || p.emergency_notes) && (
        <div className="card grid gap-3">
          {p.blood_group && <Info label={t("blood")} v={p.blood_group} />}
          {p.allergies && <Info label={t("allergies")} v={p.allergies} />}
          {p.hospital_number && <Info label={t("file")} v={p.hospital_number} />}
          {p.emergency_notes && <Info label={t("notes")} v={p.emergency_notes} />}
        </div>
      )}
      {missing.length > 0 && (
        <p className="muted px-1 text-sm">
          {t("missing")} {missing.join(lang === "ar" ? "، " : ", ")}.
        </p>
      )}
      {canEdit &&
        (edit ? (
          <form onSubmit={save} className="card flex flex-col gap-3">
            {FIELDS.map(([k, label]) => (
              <label key={k} className="flex flex-col gap-1">
                <span className="font-semibold">{label}</span>
                {k === "emergency_notes" ? (
                  <textarea className="input" rows={3} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
                ) : (
                  <input className="input" inputMode={k.endsWith("phone") || k.endsWith("ambulance") ? "tel" : undefined} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
                )}
              </label>
            ))}
            {msg && <p className="text-[var(--danger)]">{msg}</p>}
            <div className="grid grid-cols-2 gap-3">
              <button type="button" className="btn" onClick={() => setEdit(false)} disabled={busy}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        ) : (
          <button type="button" className="btn" onClick={() => setEdit(true)}>
            {t("edit")}
          </button>
        ))}
    </div>
  );
}
function Info({ label, v }: { label: string; v?: string }) {
  return (
    <div>
      <p className="muted text-sm font-semibold">{label}</p>
      <p className="whitespace-pre-wrap text-lg font-bold">{v}</p>
    </div>
  );
}
