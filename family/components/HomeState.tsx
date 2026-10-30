"use client";
import { useEffect, useState } from "react";
import type { HomeSummary } from "@/lib/types";
import { fmtDuration, fmtTime } from "@/lib/time";
import { useMe } from "@/lib/me-context";
import { supabaseBrowser } from "@/lib/supabase/client";
import { mergeOngoing, onQueueChange, readQueueFor, type QueuedOp } from "@/lib/offline";
import { napWindow } from "@/lib/backlog";

const H12 = 12 * 60;

/**
 * The card at the top of Home (DESIGN.md, "Home"): what she is doing, in big type. Awake,
 * it is the next-nap window (Huckleberry's SweetSpot idea: "11:20 – 11:50", how long she has
 * been awake, a bar filling towards the window; over an hour past it, when she last woke, since
 * a nap was most likely not logged). Asleep or feeding, the running time. A gap
 * in the log (no sleep for 12 hours) says nothing rather than "awake 20 h" (rule 6). The last
 * feed, sleep and nappy are on the rows below, so the card does not repeat them. Timers
 * started or ended on this phone without signal count straight away (the offline queue).
 * Ticks every 30 seconds.
 */
export function HomeState({ summary, timezone, nap }: { summary: HomeSummary; timezone: string; nap: { at: number; isBedtime: boolean } | null }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const mins = (iso: string) => (now == null ? null : Math.max(0, Math.round((now - Date.parse(iso)) / 60_000)));

  const me = useMe();
  const [queue, setQueue] = useState<QueuedOp[]>([]);
  useEffect(() => {
    const sb = supabaseBrowser();
    const load = () => void readQueueFor(sb).then(setQueue);
    load();
    return onQueueChange(load);
  }, []);
  const ongoing = mergeOngoing(summary.ongoing, summary.subject.id, queue, me.member.display_name, summary.types);
  const asleep = ongoing.find((e) => e.type_id === "lana.sleep");
  const feeding = ongoing.find((e) => e.type_id === "lana.feed");
  // A sleep ended on this phone and not yet sent: she woke then.
  const serverSleep = summary.ongoing.find((e) => e.type_id === "lana.sleep");
  const endedHere = serverSleep ? queue.find((x) => x.op === "end" && x.entry_id === serverSleep.id) : undefined;
  const woke = (endedHere && endedHere.op === "end" ? endedHere.ended_at : null) ?? summary.last["lana.sleep"]?.ended_at ?? null;
  const awakeMin = !feeding && !asleep && woke ? mins(woke) : null;
  const awakeKnown = awakeMin != null && awakeMin <= H12;

  const big = (label: string, value: string, tint: string, sub?: string) => (
    <section aria-label="Right now" aria-live="polite" className={`card ${tint} flex flex-col gap-1`}>
      <p className="text-[0.95rem] font-semibold">{label}</p>
      <p className="font-[family-name:var(--font-display)] text-[2.4rem] font-semibold leading-[1.05] tabular-nums">{value}</p>
      {sub && <p className="text-[0.95rem] opacity-80">{sub}</p>}
    </section>
  );

  if (feeding) return big("Feeding", now == null ? "—" : fmtDuration(mins(feeding.occurred_at)!), "tint-feed");
  if (asleep) return big("Asleep", now == null ? "—" : fmtDuration(mins(asleep.occurred_at)!), "tint-sleep", `since ${fmtTime(asleep.occurred_at, timezone)}`);
  const w = awakeKnown && nap && woke && now != null ? napWindow(Date.parse(woke), nap.at, now) : null;
  // Over an hour past the window, a nap was most likely not logged: say when she woke, not "late by 5 h".
  if (w && w.late > 60) return big("Last woke", fmtTime(woke!, timezone), "", "If she napped since, log it below.");
  if (w && nap) {
    const say = w.late > 0 ? `Past the window by ${fmtDuration(w.late)}.` : w.untilMin > 0 ? `In ${fmtDuration(w.untilMin)}. Start winding down.` : "Now. Start winding down.";
    return (
      <section aria-label="Right now" aria-live="polite" className="card tint-sleep flex flex-col gap-2">
        <p className="flex items-baseline justify-between gap-2">
          <span className="text-[0.95rem] font-bold">{nap.isBedtime ? "Bedtime" : "Next nap"}</span>
          <span className="text-[0.95rem] opacity-80">awake {fmtDuration(awakeMin!)}</span>
        </p>
        <p className="font-[family-name:var(--font-display)] text-[2.4rem] font-semibold leading-[1.05] tabular-nums">
          {fmtTime(new Date(w.from).toISOString(), timezone)} – {fmtTime(new Date(w.to).toISOString(), timezone)}
        </p>
        <div className="nap-bar" role="img" aria-label={`Awake ${fmtDuration(awakeMin!)} of about ${fmtDuration(Math.round((nap.at - Date.parse(woke!)) / 60_000))}`}>
          <span className="nap-bar-window" style={{ left: `${w.windowStartPct}%` }} />
          <span className="nap-bar-fill" style={{ width: `${w.pct}%` }} />
        </div>
        <p className="text-[0.95rem]">{say}</p>
      </section>
    );
  }
  if (awakeKnown) return big("Awake for", fmtDuration(awakeMin!), "");
  return <p className="muted text-lg">Tap a row below to log the first thing today.</p>;
}
