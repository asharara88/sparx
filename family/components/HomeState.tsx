"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { HomeSummary } from "@/lib/types";
import { fmtDuration, fmtTime } from "@/lib/time";
import { useMe } from "@/lib/me-context";
import { supabaseBrowser } from "@/lib/supabase/client";
import { mergeOngoing, onQueueChange, readQueueFor, type QueuedOp } from "@/lib/offline";
import { runningTimers } from "@/lib/backlog";
import { topCard } from "@/lib/child-insights";
import { pronouns } from "@/lib/names";
import type { Stage } from "@/lib/stage";

/**
 * The card at the top of Home (DESIGN.md, "Home"): what she is doing, in big type. Awake,
 * it is the next-nap window (Huckleberry's SweetSpot idea: "11:20 – 11:50", how long she has
 * been awake, a bar filling towards the window; over an hour past it, when she last woke, since
 * a nap was most likely not logged). Asleep or feeding, the running time. A gap
 * in the log (no sleep for 12 hours, 16 from 12 months: a child with no nap is up 12 to 13)
 * says nothing rather than "awake 20 h" (rule 6). A toddler with no nap expected has no window,
 * and long past a bedtime window the card says "Awake for" (lib/child-insights topCard). The last
 * feed, sleep and diaper are on the rows below, so the card does not repeat them. Timers
 * started or ended on this phone, or still on their way to the server, count straight
 * away (lib/offline.ts). The clock starts on the server's time, so the first paint shows
 * the number (not a dash) and matches the server-rendered screen; this phone's clock
 * takes over after, every 30 seconds.
 */
export function HomeState({ summary, stage, timezone, clockIso, nap }: { summary: HomeSummary; /** The child's stage: a toddler's limits hold "Awake for" longer. */ stage: Pick<Stage, "toddler" | "limits">; timezone: string; clockIso: string; nap: { at: number; isBedtime: boolean } | null }) {
  const [now, setNow] = useState(() => Date.parse(clockIso));
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const mins = (iso: string) => Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));

  const me = useMe();
  const [queue, setQueue] = useState<QueuedOp[]>([]);
  useEffect(() => {
    const sb = supabaseBrowser();
    const load = () => void readQueueFor(sb).then(setQueue);
    load();
    return onQueueChange(load);
  }, []);
  const ongoing = runningTimers(mergeOngoing(summary.ongoing, summary.subject.id, queue, me.member.display_name, summary.types), now);
  const asleep = ongoing.find((e) => e.type_id === "lana.sleep");
  const feeding = ongoing.find((e) => e.type_id === "lana.feed");
  // A sleep ended on this phone and not yet sent: she woke then.
  const serverSleep = summary.ongoing.find((e) => e.type_id === "lana.sleep");
  const endedHere = serverSleep ? queue.find((x) => x.op === "end" && x.entry_id === serverSleep.id) : undefined;
  const woke = (endedHere && endedHere.op === "end" ? endedHere.ended_at : null) ?? summary.last["lana.sleep"]?.ended_at ?? null;
  const card = topCard({ stage, feedingSince: feeding?.occurred_at ?? null, asleepSince: asleep?.occurred_at ?? null, woke, nap, now });
  const p = pronouns(typeof summary.subject.profile?.sex === "string" ? summary.subject.profile.sex : null);

  // The card opens its section (Mido, 7 November), chosen from the state it shows: feeding,
  // the Feeds; otherwise the Sleep. Taps still on this phone count, as on the card itself.
  const wrap = (node: React.ReactNode) => (
    <Link prefetch={false} href={feeding ? "/baby/feed" : "/baby/sleep"} className="block no-underline">
      {node}
    </Link>
  );
  const big = (label: string, value: string, tint: string, sub?: string) => (
    <section aria-label="Right now" aria-live="polite" className={`card ${tint} flex flex-col gap-1`}>
      <p className="text-[0.95rem] font-semibold">{label}</p>
      <p className="font-[family-name:var(--font-display)] text-[2.4rem] font-semibold leading-[1.05] tabular-nums">{value}</p>
      {sub && <p className="text-[0.95rem] opacity-80">{sub}</p>}
    </section>
  );

  // A running timer (24 November): a dot beside the word, when it began on the same line, and
  // the way to its section said in words at the foot. The card is as tall as it was.
  const running = (label: string, value: string, tint: string, since: string, out: string) => (
    <section aria-label="Right now" aria-live="polite" className={`card ${tint} flex flex-col gap-1`}>
      <p className="flex items-baseline justify-between gap-2">
        <span className="text-[0.95rem] font-bold">
          <span className="live-dot" aria-hidden="true" />
          {label}
        </span>
        <span className="text-[0.95rem] opacity-80">{since}</span>
      </p>
      <p className="font-[family-name:var(--font-display)] text-[2.4rem] font-semibold leading-[1.05] tabular-nums">{value}</p>
      <p className="state-out">{out} ›</p>
    </section>
  );

  if (card.kind === "feeding") return wrap(running("Feeding", fmtDuration(mins(card.since)), "tint-feed", `since ${fmtTime(card.since, timezone)}`, "All feeds"));
  if (card.kind === "asleep") return wrap(running("Asleep", fmtDuration(mins(card.since)), "tint-sleep", `since ${fmtTime(card.since, timezone)}`, "All sleep"));
  // Over an hour past the window, a nap was most likely not logged: say when she woke, not "late by 5 h".
  if (card.kind === "last_woke") return wrap(big("Last woke", fmtTime(card.woke, timezone), "", `If ${p.they} napped since, log it below.`));
  if (card.kind === "window" && nap) {
    return wrap(
      <section aria-label="Right now" aria-live="polite" className="card tint-sleep flex flex-col gap-2">
        <p className="flex items-baseline justify-between gap-2">
          <span className="text-[0.95rem] font-bold">{card.label}</span>
          <span className="text-[0.95rem] opacity-80">up since {fmtTime(card.woke, timezone)}</span>
        </p>
        <p className="font-[family-name:var(--font-display)] text-[2.4rem] font-semibold leading-[1.05] tabular-nums">
          {fmtTime(new Date(card.from).toISOString(), timezone)} – {fmtTime(new Date(card.to).toISOString(), timezone)}
        </p>
        <div className="nap-bar" role="img" aria-label={`Awake ${fmtDuration(card.awakeMin)} of about ${fmtDuration(Math.round((nap.at - Date.parse(card.woke)) / 60_000))}`}>
          <span className="nap-bar-window" style={{ left: `${card.windowStartPct}%` }} />
          <span className="nap-bar-fill" style={{ width: `${card.pct}%` }} />
        </div>
        <p className="text-[0.95rem]">{card.say}</p>
      </section>
    );
  }
  if (card.kind === "awake") return wrap(big("Awake for", fmtDuration(card.awakeMin), "", `since ${fmtTime(card.woke, timezone)}`));
  return <p className="muted text-lg">Tap below, or tell me what happened.</p>;
}
