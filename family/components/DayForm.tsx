"use client";
import { useState } from "react";
import Link from "next/link";
import type { DayAnswers } from "@/lib/day";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Icon } from "@/components/Icon";

// Each answer with the word on its button and, where it changes a screen, the line that says how.
const MILK: [DayAnswers["milk"], string, string][] = [
  ["drink", "A drink", "Milk is logged. Nothing is due."],
  ["clock", "On a clock", "Home says when the next feed is due."],
  ["off", "Not logged", "No milk row on Home."],
];
const NAPS: [DayAnswers["naps"], string, string?][] = [
  [2, "Two"],
  [1, "One"],
  [0, "None", "No nap window and no nap reminder."],
];
const DIAPERS: [DayAnswers["diapers"], string][] = [
  ["diapers", "Diapers"],
  ["off", "Not logged"],
];
const STORED: [boolean, string, string][] = [
  [true, "Yes", "Pumped milk in the fridge or freezer."],
  [false, "No", "No Milk tab and no Pump in the + menu."],
];

/** One question: its name, the answers as a segmented control, and the chosen answer's line. */
function Ask<T extends string | number | boolean>({ label, options, value, onChange }: { label: string; options: readonly (readonly [T, string, string?])[]; value: T; onChange: (v: T) => void }) {
  const line = options.find(([v]) => v === value)?.[2];
  return (
    <div className="row flex-col px-4" role="group" aria-label={label}>
      <span className="font-semibold">{label}</span>
      {/* Three answers on a narrow phone (iPhone SE): a size down so "Not logged" stays inside its button. In px, so large text does not undo it. */}
      <div className="segmented max-[360px]:text-[14px]">
        {options.map(([v, words]) => (
          <button key={String(v)} type="button" aria-pressed={v === value} onClick={() => onChange(v)}>
            {words}
          </button>
        ))}
      </div>
      {line && <p className="muted text-sm">{line}</p>}
    </div>
  );
}

/**
 * The form of "{Name}'s day" (app/(app)/baby/day), built as the log form is: one card, a row
 * per question, Save as the bottom button. It opens on the answers the page hands it and
 * sends them to subject_day_save, which checks them again and whose words are shown when it
 * refuses. Every rule about the answers is in lib/day.ts; none is here.
 */
export function DayForm({
  subjectId,
  start,
  nightFrom,
  nightTo,
  bottles,
  door,
}: {
  subjectId: string;
  /** The answers the screen opens on (lib/day.ts suggestDay). */
  start: DayAnswers;
  /** The child's night as stored, "hh:mm". */
  nightFrom: string;
  nightTo: string;
  /** Bottles in stock. With any, stored milk is not asked: it is yes. */
  bottles: number;
  /** How the screen was reached: once after sign-up, from Home's offer, or from About the child. */
  door: "first" | "offer" | "about";
}) {
  const [milk, setMilk] = useState(start.milk);
  const [naps, setNaps] = useState(start.naps);
  // Potty is not among the answers here: both and potty open as Diapers, as they read wherever the Potty entry is not on (lib/day.ts).
  const [diapers, setDiapers] = useState<DayAnswers["diapers"]>(start.diapers === "off" ? "off" : "diapers");
  const [stores, setStores] = useState(start.stores_milk);
  const [from, setFrom] = useState(nightFrom);
  const [to, setTo] = useState(nightTo);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  /** Save the answers, or with none settle the question as it is ("Keep it as it is"). */
  async function send(day: DayAnswers | null) {
    setBusy(true);
    setMsg(null);
    // A time left as it was is not sent: the stored night stays as it is.
    const args = day ? { p_subject_id: subjectId, p_day: day, p_night_from: from !== nightFrom ? from : null, p_night_to: to !== nightTo ? to : null } : { p_subject_id: subjectId };
    const { data, error } = await supabaseBrowser().rpc("subject_day_save", args);
    const res = data as { ok: boolean; message?: string } | null;
    if (error || !res?.ok) {
      setBusy(false);
      return setMsg(res?.message ?? error?.message ?? "Could not save.");
    }
    // A full load, so the tab bar, the night screen and Home all start from the new day.
    window.location.assign("/");
  }

  return (
    <>
      {/* noValidate: the database is the one judge of a time, and says so in the card; the boxes' own limits only guide the picker. */}
      <form
        id="day-form"
        noValidate
        className="card flex flex-col p-0"
        onSubmit={(e) => {
          e.preventDefault();
          void send({ milk, naps, diapers, stores_milk: bottles > 0 || stores });
        }}
      >
        <Ask label="Milk" options={MILK} value={milk} onChange={setMilk} />
        <Ask label="Naps a day" options={NAPS} value={naps} onChange={setNaps} />
        <Ask label="Diapers" options={DIAPERS} value={diapers} onChange={setDiapers} />
        <div className="row flex-col px-4">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-2">
              <span className="font-semibold">Bedtime</span>
              <input className="input" type="time" step={900} min="17:00" max="23:45" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="flex flex-col gap-2">
              <span className="font-semibold">Morning</span>
              <input className="input" type="time" step={900} min="04:00" max="10:00" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>
          <p className="muted text-sm">Sleep between these is the night, on past days too.</p>
        </div>
        {bottles > 0 ? (
          <Link prefetch={false} href="/baby/milk" className="row row-link px-4">
            <span className="flex-1 font-semibold">
              Stored milk: {bottles} {bottles === 1 ? "bottle" : "bottles"} in Milk.
            </span>
            <Icon name="forward" size={18} className="muted" />
          </Link>
        ) : (
          <Ask label="Stored milk" options={STORED} value={stores} onChange={setStores} />
        )}
        {msg && (
          <p role="alert" className="row px-4 font-semibold text-[var(--danger)]">
            {msg}
          </p>
        )}
      </form>
      {door === "offer" && (
        <button type="button" className="flex min-h-[44px] items-center justify-center font-semibold text-[var(--accent)]" disabled={busy} onClick={() => void send(null)}>
          Keep it as it is
        </button>
      )}
      {door === "first" && (
        <Link prefetch={false} href="/" className="flex min-h-[44px] items-center justify-center font-semibold text-[var(--accent)] no-underline">
          Later
        </Link>
      )}
      <div className="bottom-action">
        <button type="submit" form="day-form" className="btn btn-primary btn-lg w-full" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </>
  );
}
