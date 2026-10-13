"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Subject } from "@/lib/types";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Icon } from "./Icon";

const T = {
  call: { en: "Call 998 ambulance", ar: "اتصل بالإسعاف ٩٩٨", ru: "Скорая 998" },
  doctor: { en: "Lana's doctor", ar: "دكتور لانا", ru: "Врач Ланы" },
  hospital: { en: "Hospital", ar: "المستشفى", ru: "Больница" },
  papa: { en: "Papa", ar: "بابا", ru: "Папа" },
  mama: { en: "Mama", ar: "ماما", ru: "Мама" },
  blood: { en: "Blood group", ar: "فصيلة الدم", ru: "Группа крови" },
  allergies: { en: "Allergies", ar: "حساسية", ru: "Аллергия" },
  notes: { en: "Medical notes", ar: "ملاحظات طبية", ru: "Заметки" },
  file: { en: "Hospital file", ar: "رقم الملف", ru: "Номер карты" },
  empty: { en: "Not filled in yet", ar: "لسه مش مكتوب", ru: "Ещё не заполнено" },
  map: { en: "Map", ar: "الخريطة", ru: "Карта" },
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
  const t = (k: keyof typeof T) => T[k][lang];
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState<Record<string, string>>(Object.fromEntries(FIELDS.map(([k]) => [k, p[k] ?? ""])));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const ambulance = p.emergency_ambulance || "998";

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
        <p className="truncate text-xl font-bold">{name || phone || t("empty")}</p>
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

  return (
    <div dir={lang === "ar" ? "rtl" : "ltr"} className="flex flex-col gap-3">
      <a href={tel(ambulance)} className="flex items-center justify-center gap-3 rounded-3xl bg-[var(--danger)] p-6 text-2xl font-bold text-white shadow-[var(--shadow)] active:scale-[0.98]">
        <Icon name="phone" size={30} /> {t("call").replace("998", ambulance)}
      </a>
      <CallRow label={t("doctor")} name={p.doctor_name} phone={p.doctor_tollfree || p.doctor_phone} />
      <CallRow label={t("papa")} phone={p.emergency_papa_phone} />
      <CallRow label={t("mama")} phone={p.emergency_mama_phone} />
      <div className="card flex flex-col gap-1">
        <p className="muted text-sm font-semibold">{t("hospital")}</p>
        <p className="text-xl font-bold">{p.emergency_hospital || p.doctor_hospital || t("empty")}</p>
        {(p.emergency_hospital_map || p.doctor_address) && (
          <a href={p.emergency_hospital_map || `https://maps.google.com/?q=${encodeURIComponent(p.doctor_address ?? "")}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-[var(--accent)] underline">
            <Icon name="pin" size={16} /> {t("map")}
          </a>
        )}
      </div>
      <div className="card grid gap-3">
        <Info label={t("blood")} v={p.blood_group} empty={t("empty")} />
        <Info label={t("allergies")} v={p.allergies} empty={t("empty")} />
        <Info label={t("file")} v={p.hospital_number} empty={t("empty")} />
        <Info label={t("notes")} v={p.emergency_notes} empty={t("empty")} />
      </div>
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
            Edit details
          </button>
        ))}
    </div>
  );
}
function Info({ label, v, empty }: { label: string; v?: string; empty: string }) {
  return (
    <div>
      <p className="muted text-sm font-semibold">{label}</p>
      <p className="whitespace-pre-wrap text-lg font-bold">{v || empty}</p>
    </div>
  );
}
