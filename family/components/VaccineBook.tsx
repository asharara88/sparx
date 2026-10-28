"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { VaccineItem, VaccinesData } from "@/lib/types";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ageLabel } from "@/lib/norms";
import { dateWords } from "@/lib/time";
import { Fold } from "./Fold";
import { Icon } from "./Icon";

/**
 * The vaccine book: one card per visit (Birth, 2 months, 4 months...), each
 * dose with its status, "all given on" for a whole visit in one go, and a
 * per-dose date for the odd one given on another day. Undo needs edit rights.
 */
type Visit = { visit: string; due_on: string | null; items: VaccineItem[]; status: VaccineItem["status"] | "partial" };

function statusOf(items: VaccineItem[]): Visit["status"] {
  const given = items.filter((i) => i.status === "given").length;
  if (given === items.length) return "given";
  if (given > 0) return "partial";
  if (items.some((i) => i.status === "overdue")) return "overdue";
  if (items.some((i) => i.status === "due")) return "due";
  if (items.some((i) => i.status === "unknown")) return "unknown";
  return "upcoming";
}

const fmt = (ymd: string | null) => (ymd ? dateWords(new Date(`${ymd}T12:00:00Z`), { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");

export function VaccineBook({ subjectId, data, timezone, canAdd, canEdit }: { subjectId: string; data: VaccinesData; timezone: string; canAdd: boolean; canEdit: boolean }) {
  void timezone;
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [date, setDate] = useState<Record<string, string>>({});
  const [place, setPlace] = useState<Record<string, string>>({});

  const visits = useMemo<Visit[]>(() => {
    const m = new Map<string, VaccineItem[]>();
    for (const it of data.items) m.set(it.visit, [...(m.get(it.visit) ?? []), it]);
    return [...m.entries()].map(([visit, items]) => ({ visit, due_on: items[0].due_on, items, status: statusOf(items) }));
  }, [data.items]);

  const next = visits.find((v) => v.status === "due" || v.status === "overdue" || v.status === "partial") ?? visits.find((v) => v.status === "upcoming");
  const givenCount = data.items.filter((i) => i.status === "given").length;

  async function record(ids: string[], givenOn: string, where: string) {
    if (!givenOn) {
      setMsg("Pick the date it was given.");
      return;
    }
    setBusy(ids.join(","));
    setMsg(null);
    try {
      for (const id of ids) {
        const { data: r, error } = await supabaseBrowser().rpc("vaccine_record", { p_subject_id: subjectId, p_schedule_id: id, p_given_on: givenOn, p_place: where || null, p_batch: null, p_note: null });
        const res = r as { ok: boolean; message?: string } | null;
        if (error || !res?.ok) throw new Error(res?.message ?? error?.message ?? "Not saved.");
      }
      setOpen(null);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Not saved.");
    } finally {
      setBusy(null);
    }
  }

  async function undo(id: string) {
    if (!window.confirm("Remove this record? The dose will show as not given.")) return;
    setBusy(id);
    const { data: r } = await supabaseBrowser().rpc("vaccine_unrecord", { p_id: id });
    const res = r as { ok: boolean; message?: string } | null;
    if (!res?.ok) setMsg(res?.message ?? "Could not remove it.");
    setBusy(null);
    router.refresh();
  }

  const pill = (s: Visit["status"] | VaccineItem["status"]) =>
    s === "given" ? <span className="pill pill-ok">given</span>
    : s === "partial" ? <span className="pill pill-warn">partly given</span>
    : s === "due" ? <span className="pill pill-accent">due now</span>
    : s === "overdue" ? <span className="pill pill-danger">overdue</span>
    : s === "unknown" ? <span className="pill">no birth date</span>
    : <span className="pill">later</span>;

  // One visit's card: its doses, each with its status, and "all given on one day".
  const visitCard = (v: Visit) => {
        const outstanding = v.items.filter((i) => i.status !== "given");
        const key = `visit:${v.visit}`;
        return (
          <section key={v.visit} className={`card flex flex-col gap-2 ${v.status === "upcoming" ? "opacity-80" : ""}`}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="section-title">{v.visit}</h2>
              <span className="flex items-center gap-2">
                {v.due_on && <span className="muted text-sm">{fmt(v.due_on)}</span>}
                {pill(v.status)}
              </span>
            </div>
            <ul className="flex flex-col divide-y divide-[var(--line)]">
              {v.items.map((it) => (
                <li key={it.id} className="flex flex-col gap-1 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {it.vaccine} <span className="muted">· dose {it.dose}</span>
                      </p>
                      {it.given ? (
                        <p className="muted text-sm">
                          Given {fmt(it.given.given_on)}
                          {it.given.place ? ` at ${it.given.place}` : ""}
                          {it.given.batch ? ` · batch ${it.given.batch}` : ""}
                          {it.given.recorded_by ? ` · by ${it.given.recorded_by}` : ""}
                        </p>
                      ) : (
                        it.note && <p className="muted text-sm">{it.note}</p>
                      )}
                    </div>
                    {it.given ? (
                      <span className="flex items-center gap-2">
                        <Icon name="check" size={20} className="text-[var(--ok)]" />
                        {canEdit && (
                          <button type="button" className="btn btn-ghost text-sm" disabled={busy === it.given.id} onClick={() => undo(it.given!.id)}>
                            Undo
                          </button>
                        )}
                      </span>
                    ) : (
                      canAdd && (
                        <button type="button" className="btn btn-secondary text-sm" onClick={() => setOpen(open === it.id ? null : it.id)} aria-expanded={open === it.id}>
                          Given
                        </button>
                      )
                    )}
                  </div>
                  {open === it.id && (
                    <form
                      className="flex flex-wrap items-end gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void record([it.id], date[it.id] ?? it.due_on ?? data.today, place[it.id] ?? "");
                      }}
                    >
                      <label className="flex flex-col text-sm">
                        Date
                        <input type="date" className="input" required max={data.today} value={date[it.id] ?? (it.due_on && it.due_on <= data.today ? it.due_on : data.today)} onChange={(e) => setDate({ ...date, [it.id]: e.target.value })} />
                      </label>
                      <label className="flex min-w-[8rem] flex-1 flex-col text-sm">
                        Where (optional)
                        <input className="input" value={place[it.id] ?? ""} onChange={(e) => setPlace({ ...place, [it.id]: e.target.value })} placeholder="Clinic" />
                      </label>
                      <button type="submit" className="btn btn-primary" disabled={busy !== null}>
                        Save
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
            {canAdd && outstanding.length > 1 && v.status !== "upcoming" && (
              <div>
                {open === key ? (
                  <form
                    className="flex flex-wrap items-end gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void record(outstanding.map((i) => i.id), date[key] ?? v.due_on ?? data.today, place[key] ?? "");
                    }}
                  >
                    <label className="flex flex-col text-sm">
                      All {outstanding.length} given on
                      <input type="date" className="input" required max={data.today} value={date[key] ?? (v.due_on && v.due_on <= data.today ? v.due_on : data.today)} onChange={(e) => setDate({ ...date, [key]: e.target.value })} />
                    </label>
                    <label className="flex min-w-[8rem] flex-1 flex-col text-sm">
                      Where (optional)
                      <input className="input" value={place[key] ?? ""} onChange={(e) => setPlace({ ...place, [key]: e.target.value })} placeholder="Clinic" />
                    </label>
                    <button type="submit" className="btn btn-primary" disabled={busy !== null}>
                      Save
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => setOpen(null)}>
                      Cancel
                    </button>
                  </form>
                ) : (
                  <button type="button" className="btn btn-primary w-full" onClick={() => setOpen(key)}>
                    <Icon name="check" size={18} /> All {outstanding.length} given on one day
                  </button>
                )}
              </div>
            )}
          </section>
        );
      };
  // What matters now first: the visits due or overdue and the next one. Done and later ones fold away.
  // The next visit only when nothing is due: one thing to do at a time.
  const nextUpcoming = visits.some((v) => v.status !== "given" && v.status !== "upcoming") ? undefined : visits.find((v) => v.status === "upcoming");
  const isNow = (v: Visit) => v.status !== "given" && (v.status !== "upcoming" || v === nextUpcoming);
  const done = visits.filter((v) => v.status === "given");
  const now = visits.filter(isNow);
  const later = visits.filter((v) => v.status === "upcoming" && v !== nextUpcoming);

  return (
    <div className="flex flex-col gap-3">
      {!data.birth_date && <p className="notice notice-warn">Add the date of birth on the profile and the dates will fill in.</p>}
      <section className="card flex items-center gap-3">
        <Icon name="syringe" size={24} className="shrink-0" />
        <div className="flex-1">
          <p className="font-semibold">
            {givenCount} of {data.items.length} doses recorded
            {data.birth_date ? ` · ${ageLabel(Math.floor((Date.parse(data.today) - Date.parse(data.birth_date)) / 86_400_000))} old` : ""}
          </p>
          {next && (
            <p className="muted text-sm">
              Next: {next.visit} visit{next.due_on ? `, due around ${fmt(next.due_on)}` : ""}
              {next.status === "overdue" ? ". The window has closed, book it." : ""}
            </p>
          )}
        </div>
      </section>

      {msg && (
        <p role="alert" className="notice notice-danger">
          {msg}
        </p>
      )}

      {now.map(visitCard)}
      {later.length > 0 && (
        <Fold title="Later visits" icon="calendar" tint="cal" hint={`${later.length}`}>
          {later.map(visitCard)}
        </Fold>
      )}
      {done.length > 0 && (
        <Fold title="Given" icon="check" tint="milk" hint={`${done.length} visit${done.length === 1 ? "" : "s"}`}>
          {done.map(visitCard)}
        </Fold>
      )}
      <p className="muted text-xs">Schedule: UAE national programme (DHA). The clinic&apos;s card wins. Not medical advice.</p>
    </div>
  );
}
