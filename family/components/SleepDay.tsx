import type { EntryRow } from "@/lib/types";
import { sleepDay } from "@/lib/sleep-day";
import { fmtTime, zonedMidnight } from "@/lib/time";
import { SleepBar, SleepSince } from "@/components/SleepDayLive";
import { napsLine } from "@/lib/stage";

/**
 * Sleep today, on the child's Today tab: what she is doing now and since when
 * (woke at 07:10, awake 2 h 15 min; asleep since 13:00), the day's sleep path
 * as one bar from midnight (the night she woke from, each nap, where "now" is),
 * and one line of sums. The times of each nap are in the list below, not here.
 * Server-rendered; the duration and the bar's "now" tick on the phone.
 */
export function SleepDay({ entries, day, timezone, nowIso, night, usualNaps = null, sums: showSums = true }: { entries: EntryRow[]; day: string; timezone: string; nowIso?: string; night: { from: string; to: string }; /** Naps usual at this age (lib/stage): "2 of 2–3 naps". */ usualNaps?: [number, number] | null; /** Off on Home, where the strip at the top already says when she woke and the naps. */ sums?: boolean }) {
  const start = zonedMidnight(day, timezone).getTime();
  const end = start + 24 * 3600 * 1000;
  const now = nowIso ? Math.min(Date.parse(nowIso), end) : end;
  const isToday = !!nowIso && Date.parse(nowIso) < end;
  const hours = (hhmm: string, fallback: number) => {
    const n = Number(hhmm.slice(0, 2)) + Number(hhmm.slice(3, 5) || 0) / 60;
    return Number.isFinite(n) ? n : fallback;
  };
  const hourOf = (ms: number) => {
    const p = new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "numeric", hourCycle: "h23", timeZone: timezone }).format(new Date(ms)).split(":");
    return Number(p[0]) + Number(p[1]) / 60;
  };
  const s = sleepDay(entries, start, now, { bedtimeHour: hours(night.from, 19), morningHour: hours(night.to, 7), hourOf });
  if (!s.segments.length && s.state.kind === "unknown") return null;
  const at = (ms: number) => fmtTime(new Date(ms).toISOString(), timezone);
  const clockIso = new Date(now).toISOString();

  let headline: string;
  let since: { iso: string; prefix: string } | null = null;
  if (!isToday) headline = s.wokeAt ? `Up at ${at(s.wokeAt)}` : "Sleep that day";
  else if (s.state.kind === "asleep") {
    headline = `${s.state.sleep === "night" ? "Night" : "Nap"} since ${at(s.state.since)}`;
    since = { iso: new Date(s.state.since).toISOString(), prefix: "" };
  } else if (s.state.kind === "awake" && s.state.since != null) {
    headline = `${s.state.afterNap ? "Up from a nap at" : "Woke up at"} ${at(s.state.since)}`;
    since = { iso: new Date(s.state.since).toISOString(), prefix: "awake " };
  } else headline = s.wokeAt ? `Up at ${at(s.wokeAt)}` : "Nothing logged yet today";
  // The day's total sleep is on the strip above; here only what the bar does not say.
  const sums = [
    s.wokeAt && !(s.state.kind === "awake" && !s.state.afterNap) ? `up at ${at(s.wokeAt)}` : null,
    // Today with a usual count: "2 of 2–3 naps" (each nap's length is on the bar); a past day keeps its nap total.
    s.naps && !(isToday && usualNaps)
      ? `${napsLine(s.naps, usualNaps, isToday)}, ${Math.floor(s.napMin / 60) ? `${Math.floor(s.napMin / 60)} h ${s.napMin % 60 ? `${s.napMin % 60} min` : ""}`.trim() : `${s.napMin} min`}`
      : napsLine(s.naps, usualNaps, isToday),
  ].filter(Boolean);
  const label = `Sleep from midnight: ${s.segments.map((g) => `${g.kind} ${at(g.from)} to ${g.open ? "now" : at(g.to)}`).join(", ") || "none yet"}`;
  return (
    <section className="card flex flex-col gap-2" aria-labelledby="sleep-day-h">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="sleep-day-h" className="section-title">Sleep today</h2>
        {since && <SleepSince sinceIso={since.iso} clockIso={clockIso} prefix={since.prefix} />}
      </div>
      <p className="text-2xl font-bold tabular-nums">{headline}</p>
      <SleepBar segments={s.segments} dayStartMs={start} clockIso={clockIso} live={isToday} label={label} />
      <div className="muted -mt-1 flex justify-between text-[13px]">
        <span>midnight</span>
        <span>noon</span>
        <span>midnight</span>
      </div>
      {showSums && <p className="muted text-sm">{sums.join(" · ")}</p>}
    </section>
  );
}
