import type { EntryRow } from "@/lib/types";
import { sleepDay } from "@/lib/sleep-day";
import { fmtDuration, fmtTime, zonedMidnight } from "@/lib/time";

/**
 * Sleep today, on the child's Today tab: what she is doing now and since when
 * (woke at 07:10, awake 2 h 15 min; asleep since 13:00), the day's sleep path
 * as one bar from midnight (the night she woke from, each nap, where "now" is),
 * and one line of sums. The times of each nap are in the list below, not here.
 */
export function SleepDay({ entries, day, timezone, nowIso, bedtime }: { entries: EntryRow[]; day: string; timezone: string; nowIso?: string; bedtime: string }) {
  const start = zonedMidnight(day, timezone).getTime();
  const end = start + 24 * 3600 * 1000;
  const now = nowIso ? Math.min(Date.parse(nowIso), end) : end;
  const isToday = !!nowIso && Date.parse(nowIso) < end;
  const bedtimeHour = Number(bedtime.slice(0, 2)) + Number(bedtime.slice(3, 5) || 0) / 60 || 19;
  const hourOf = (ms: number) => {
    const p = new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "numeric", hourCycle: "h23", timeZone: timezone }).format(new Date(ms)).split(":");
    return Number(p[0]) + Number(p[1]) / 60;
  };
  const s = sleepDay(entries, start, now, { bedtimeHour, hourOf });
  if (!s.segments.length && s.state.kind === "unknown") return null;
  const at = (ms: number) => fmtTime(new Date(ms).toISOString(), timezone);
  const mins = (ms: number) => Math.max(0, Math.round((now - ms) / 60_000));

  let headline: string;
  let detail: string;
  if (!isToday) {
    headline = s.wokeAt ? `Up at ${at(s.wokeAt)}` : "Sleep that day";
    detail = "";
  } else if (s.state.kind === "asleep") {
    headline = `${s.state.sleep === "night" ? "Night" : "Nap"} since ${at(s.state.since)}`;
    detail = fmtDuration(mins(s.state.since));
  } else if (s.state.kind === "awake" && s.state.since != null) {
    headline = `${s.state.afterNap ? "Up from a nap at" : "Woke up at"} ${at(s.state.since)}`;
    detail = `awake ${fmtDuration(mins(s.state.since))}`;
  } else {
    headline = s.wokeAt ? `Up at ${at(s.wokeAt)}` : "Nothing logged yet today";
    detail = "";
  }
  // The day's total sleep is on the strip above; here only what the bar does not say.
  const sums = [
    s.wokeAt && !(s.state.kind === "awake" && !s.state.afterNap) ? `up at ${at(s.wokeAt)}` : null,
    s.naps ? `${s.naps} nap${s.naps === 1 ? "" : "s"}, ${fmtDuration(s.napMin)}` : isToday ? "no nap yet" : "no nap",
  ].filter(Boolean);

  const W = 1440;
  const H = 16;
  const x = (ms: number) => Math.max(0, Math.min(W, (ms - start) / 60_000));
  return (
    <section className="card flex flex-col gap-2" aria-labelledby="sleep-day-h">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="sleep-day-h" className="section-title">Sleep today</h2>
        {detail && <span className="muted text-sm tabular-nums">{detail}</span>}
      </div>
      <p className="text-2xl font-bold tabular-nums">{headline}</p>
      <svg viewBox={`0 0 ${W} ${H + 4}`} className="h-6 w-full" preserveAspectRatio="none" role="img" aria-label={`Sleep from midnight: ${s.segments.map((g) => `${g.kind} ${at(g.from)} to ${g.open ? "now" : at(g.to)}`).join(", ") || "none yet"}`}>
        <rect x={0} y={0} width={W} height={H} rx={4} fill="var(--card-2)" />
        {[360, 720, 1080].map((t) => (
          <line key={t} x1={t} x2={t} y1={0} y2={H} stroke="var(--line)" strokeWidth={2} />
        ))}
        {s.segments.map((g, i) => (
          <rect key={i} x={x(g.from)} y={0} width={Math.max(6, x(g.to) - x(g.from))} height={H} rx={3} fill="var(--accent)" opacity={g.kind === "night" ? 1 : 0.55} />
        ))}
        {isToday && <rect x={x(now) - 2} y={0} width={4} height={H + 4} fill="var(--fg)" />}
      </svg>
      <div className="muted -mt-1 flex justify-between text-[13px]">
        <span>midnight</span>
        <span>noon</span>
        <span>midnight</span>
      </div>
      <p className="muted text-sm">{sums.join(" · ")}</p>
    </section>
  );
}
