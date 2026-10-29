"use client";
import { useEffect, useState } from "react";
import type { HomeSummary } from "@/lib/types";
import { fmtDuration, fmtWhen } from "@/lib/time";

const H12 = 12 * 60;

/**
 * Her state in big type, the first thing Home says: asleep or awake and for how long,
 * and under it the last feed. A gap in the log (no sleep for 12 hours) says nothing
 * rather than "awake 20 h" (DESIGN.md, rule 6). Ticks every 30 seconds.
 */
export function HomeState({ summary, timezone }: { summary: HomeSummary; timezone: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const mins = (iso: string) => (now == null ? null : Math.max(0, Math.round((now - Date.parse(iso)) / 60_000)));

  const asleep = summary.ongoing.find((e) => e.type_id === "lana.sleep");
  const feeding = summary.ongoing.find((e) => e.type_id === "lana.feed");
  const woke = summary.last["lana.sleep"]?.ended_at ?? null;
  const feed = summary.last["lana.feed"];

  let label: string | null = null;
  let since: number | null = null;
  if (feeding) {
    label = "Feeding";
    since = mins(feeding.occurred_at);
  } else if (asleep) {
    label = "Asleep";
    since = mins(asleep.occurred_at);
  } else if (woke) {
    const m = mins(woke);
    if (m != null && m <= H12) {
      label = "Awake for";
      since = m;
    }
  }

  let feedLine: string | null = null;
  if (feed && !feeding) {
    const p = feed.payload ?? {};
    const what =
      p.method === "Bottle"
        ? `bottle${typeof p.amount_ml === "number" ? ` ${p.amount_ml} ml` : ""}`
        : p.method === "Breast"
          ? `breast${p.side ? `, ${String(p.side).toLowerCase()}` : ""}`
          : null;
    feedLine = `Last feed ${fmtWhen(feed.occurred_at, timezone, now == null ? new Date() : new Date(now))}${what ? `, ${what}` : ""}`;
  }

  if (!label && !feedLine) return <p className="muted text-lg">Nothing logged yet today. Tap below to start.</p>;
  return (
    <section aria-label="Right now" aria-live="polite">
      {label && (
        <>
          <p className="muted text-[0.95rem] font-semibold">{label}</p>
          <p className="font-[family-name:var(--font-display)] text-[2.6rem] font-semibold leading-[1.05] tabular-nums">{since == null ? "—" : fmtDuration(since)}</p>
        </>
      )}
      {feedLine && <p className={label ? "muted mt-1 text-[1.05rem]" : "text-xl font-semibold"}>{feedLine}</p>}
    </section>
  );
}
