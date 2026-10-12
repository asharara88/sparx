"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { WEEKDAYS } from "@/lib/types";
import { supabaseBrowser } from "@/lib/supabase/client";

/** Which days this person works. Tap a day to switch it on or off, then Save. */
export function WorkDaysForm({ memberId, initial }: { memberId: string; initial: number[] }) {
  const router = useRouter();
  const [days, setDays] = useState<number[]>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const order = [1, 2, 3, 4, 5, 6, 0]; // Monday first

  async function save() {
    setBusy(true);
    const { data, error } = await supabaseBrowser().rpc("work_days_set", { p_member_id: memberId, p_weekdays: days });
    setBusy(false);
    const res = data as { ok: boolean; message?: string } | null;
    setMsg(error || !res?.ok ? res?.message ?? error?.message ?? "Could not save." : "Saved.");
    router.refresh();
  }

  return (
    <section className="card">
      <h2 className="text-lg font-semibold">Work days</h2>
      <p className="muted">Leave all off for family members.</p>
      <div className="mt-3 grid grid-cols-7 gap-1">
        {order.map((d) => (
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
      {msg && (
        <p role="status" className="mt-2 font-semibold">
          {msg}
        </p>
      )}
      <button className="btn btn-primary mt-3 w-full" onClick={save} disabled={busy}>
        {busy ? "Saving…" : "Save work days"}
      </button>
    </section>
  );
}
