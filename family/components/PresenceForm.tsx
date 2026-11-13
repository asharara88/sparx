"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Presence, PresenceState } from "@/lib/types";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useMe } from "@/lib/me-context";
import { dateWords, todayYmd } from "@/lib/time";

/**
 * Where someone is (lives here, staying, away…) and from when. Its own page on More (Where you
 * are) and a sheet on a member's page; both give the title themselves, so `title` is only for
 * a place that has none.
 */
export function PresenceForm({ memberId, states, history, title, bare = false }: { memberId: string; states: PresenceState[]; history: Presence[]; title?: string; /** Inside a sheet: no card of its own. */ bare?: boolean }) {
  const router = useRouter();
  const tz = useMe().household.timezone;
  // The home's today, not the UTC one: between midnight and 04:00 in Dubai that was yesterday.
  const today = todayYmd(tz);
  // The one in force today, else the next one coming; never a stay that has ended (rule 6).
  // The same pick as the member's row and the Members list. History is newest first.
  const nowIn = history.find((p) => p.starts_on <= today && (!p.ends_on || p.ends_on >= today));
  const current = nowIn ?? history.filter((p) => p.starts_on > today).pop();
  const [state, setState] = useState(current?.state_id ?? states[0]?.id ?? "");
  const [starts, setStarts] = useState(today);
  const [ends, setEnds] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // A presence date is a calendar day, not an instant: read at noon UTC it is the same day in
  // every zone. "today", "Thu 13 Nov", with the year only when it is not this one.
  const day = (ymd: string) =>
    ymd === today
      ? "today"
      : dateWords(new Date(`${ymd}T12:00:00Z`), { weekday: "short", day: "numeric", month: "short", ...(ymd.slice(0, 4) === today.slice(0, 4) ? {} : { year: "numeric" }), timeZone: "UTC" });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await supabaseBrowser().rpc("presence_set", {
      p_member_id: memberId,
      p_state_id: state,
      p_starts_on: starts || null,
      p_ends_on: ends || null,
      p_note: note || null,
    });
    setBusy(false);
    const res = data as { ok: boolean; message?: string } | null;
    setMsg(error || !res?.ok ? res?.message ?? error?.message ?? "Could not save." : "Saved.");
    setNote("");
    router.refresh();
  }

  const upcoming = !!current && !nowIn;

  return (
    <form onSubmit={save} className={bare ? "flex flex-col gap-3" : "card flex flex-col gap-3"}>
      {title && <h2 className="text-lg font-semibold">{title}</h2>}
      {current && (
        <p className="muted">
          {upcoming ? "Next" : "Now"}: <b>{states.find((s) => s.id === current.state_id)?.label ?? current.state_id}</b> {upcoming ? "from" : "since"} {day(current.starts_on)}
          {current.ends_on ? ` until ${day(current.ends_on)}` : ""}
          {current.note ? ` — ${current.note}` : ""}
        </p>
      )}
      <div className="flex flex-wrap gap-2" role="group" aria-label="State">
        {states.map((s) => (
          <button key={s.id} type="button" className="chip" aria-pressed={state === s.id} onClick={() => setState(s.id)}>
            {s.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="font-semibold">From</span>
          <input className="input" type="date" value={starts} onChange={(e) => setStarts(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-semibold">Until</span>
          <input className="input" type="date" value={ends} onChange={(e) => setEnds(e.target.value)} />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="font-semibold">Note (optional)</span>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {msg && (
        <p role="status" className="font-semibold">
          {msg}
        </p>
      )}
      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
