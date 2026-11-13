"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { WEEKDAYS } from "@/lib/types";
import { supabaseBrowser } from "@/lib/supabase/client";
import { SheetRow } from "@/components/MemberForm";

const ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first

/** "Tue, Wed, Fri · 08:30 to 17:00", or "None": what the row says before it is opened. */
function daysLine(days: number[], from: string, to: string): string {
  const named = ORDER.filter((d) => days.includes(d)).map((d) => WEEKDAYS[d]);
  if (named.length === 0) return "None";
  const hours = from && to ? ` · ${from.slice(0, 5)} to ${to.slice(0, 5)}` : "";
  return `${named.join(", ")}${hours}`;
}

/** The member page's "Work days" row: it says the days, and opens them in a sheet. */
export function WorkDaysRow({ memberId, initial, from = "", to = "" }: { memberId: string; initial: number[]; from?: string; to?: string }) {
  return (
    <SheetRow label="Work days" hint={daysLine(initial, from, to)}>
      {(close) => <WorkDaysForm memberId={memberId} initial={initial} from={from} to={to} onSaved={close} />}
    </SheetRow>
  );
}

/** Which days this person works. Tap a day to switch it on or off, then Save. */
export function WorkDaysForm({ memberId, initial, from = "", to = "", onSaved }: { memberId: string; initial: number[]; from?: string; to?: string; onSaved?: () => void }) {
  const router = useRouter();
  const [days, setDays] = useState<number[]>(initial);
  const [workFrom, setWorkFrom] = useState(from.slice(0, 5));
  const [workTo, setWorkTo] = useState(to.slice(0, 5));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    const { data, error } = await supabaseBrowser().rpc("work_days_set", { p_member_id: memberId, p_weekdays: days, p_work_from: workFrom || null, p_work_to: workTo || null });
    setBusy(false);
    const res = data as { ok: boolean; message?: string } | null;
    if (error || !res?.ok) return setMsg(res?.message ?? error?.message ?? "Could not save.");
    router.refresh();
    if (onSaved) onSaved();
    else setMsg("Saved.");
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="muted">Leave all off for family members.</p>
      <div className="grid grid-cols-7 gap-1">
        {ORDER.map((d) => (
          <button
            key={d}
            type="button"
            className="chip px-0"
            aria-pressed={days.includes(d)}
            onClick={() => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()))}
          >
            {WEEKDAYS[d]}
          </button>
        ))}
      </div>
      {days.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold">Away from</span>
            <input className="input" type="time" value={workFrom} onChange={(e) => setWorkFrom(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold">Back by</span>
            <input className="input" type="time" value={workTo} onChange={(e) => setWorkTo(e.target.value)} />
          </label>
        </div>
      )}
      {msg && (
        <p role="status" className={`notice ${msg === "Saved." ? "notice-ok" : "notice-danger"}`}>
          {msg}
        </p>
      )}
      <button type="button" className="btn btn-primary btn-lg w-full" onClick={save} disabled={busy}>
        {busy ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
