"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { EntryRow } from "@/lib/types";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtTime, minutesBetween } from "@/lib/time";

const LONG_MIN = 45;
const KEEP_MIN = 20;

/**
 * A breastfeed over 45 minutes almost always means the timer was left on
 * (Mama fell asleep feeding). Ask once: trim it to 20 minutes, keeping the raw
 * minutes on the entry, or confirm it was real so it is not asked again.
 */
export function LongFeedCheck({ entries, timezone }: { entries: EntryRow[]; timezone: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const flagged = entries.filter((e) => {
    if (e.type_id !== "lana.feed" || e.payload.method !== "Breast" || !e.ended_at) return false;
    if (e.payload.timer_ok || e.payload.timer_capped) return false;
    const mins = Number(e.payload.duration_min) || minutesBetween(e.occurred_at, e.ended_at);
    return mins > LONG_MIN;
  });
  if (flagged.length === 0) return null;

  async function decide(e: EntryRow, ok: boolean) {
    setBusy(e.id);
    setMsg(null);
    const { data, error } = await supabaseBrowser().rpc("care_feed_trim", { p_id: e.id, p_keep_min: KEEP_MIN, p_ok: ok });
    const res = data as { ok: boolean; message?: string } | null;
    setBusy(null);
    if (error || !res?.ok) return setMsg(res?.message ?? error?.message ?? "Could not save.");
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-2" aria-label="Feeds to check">
      {flagged.map((e) => {
        const mins = Number(e.payload.duration_min) || minutesBetween(e.occurred_at, e.ended_at!);
        const side = typeof e.payload.side === "string" ? e.payload.side.toLowerCase() : null;
        return (
          <div key={e.id} className="card ring-2 ring-[var(--accent)]">
            <p className="text-lg font-bold">Timer left on?</p>
            <p className="muted text-sm">
              The feed at {fmtTime(e.occurred_at, timezone)} is saved as {mins} min{side ? ` on the ${side}` : ""}. That is longer than a normal feed.
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button type="button" className="btn btn-primary" disabled={busy === e.id} onClick={() => void decide(e, false)}>
                Yes, trim to {KEEP_MIN} min
              </button>
              <button type="button" className="btn" disabled={busy === e.id} onClick={() => void decide(e, true)}>
                It was real
              </button>
            </div>
          </div>
        );
      })}
      {msg && (
        <p className="text-sm text-[var(--danger)]" role="alert">
          {msg}
        </p>
      )}
    </section>
  );
}
