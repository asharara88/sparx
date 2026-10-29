import type { DayStats, EntryRow } from "@/lib/types";
import { fmtDuration } from "@/lib/time";

const FACE: Record<string, string> = { Happy: "😊", Calm: "😌", Fussy: "😣", Unsettled: "😢" };
const GOOD = new Set(["Happy", "Calm"]);

/**
 * Mood against sleep, day by day: the faces tapped each day beside how much
 * the child slept, and the plain reading of the two together.
 */
export function MoodPattern({ entries, days, stats, timezone }: { entries: EntryRow[]; days: string[]; stats: DayStats[]; timezone: string }) {
  const dayOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  const moods = entries.filter((e) => e.type_id === "lana.mood");
  if (moods.length === 0) return null;
  const rows = days.slice(-7).map((day) => {
    const m = moods.filter((e) => dayOf(e.occurred_at) === day).map((e) => String(e.payload.mood ?? ""));
    const s = stats.find((d) => d.day === day);
    const good = m.filter((x) => GOOD.has(x)).length;
    return { day, faces: m.map((x) => FACE[x] ?? "·").join(""), n: m.length, good, sleepMin: s ? Number(s.sleep_min ?? 0) : null, nightMin: s ? Number(s.night_sleep_min ?? 0) : null };
  });
  const withBoth = rows.filter((r) => r.n > 0 && r.sleepMin != null && r.sleepMin > 0);
  let reading: string | null = null;
  if (withBoth.length >= 3) {
    const sorted = [...withBoth].sort((a, b) => a.sleepMin! - b.sleepMin!);
    const half = Math.floor(sorted.length / 2);
    const lowSleep = sorted.slice(0, half);
    const highSleep = sorted.slice(sorted.length - half);
    const share = (xs: typeof rows) => xs.reduce((a, r) => a + r.good, 0) / Math.max(1, xs.reduce((a, r) => a + r.n, 0));
    const lo = share(lowSleep);
    const hi = share(highSleep);
    if (hi - lo >= 0.25) reading = `On the shorter-sleep days ${Math.round(lo * 100)}% of taps were happy or calm; on longer-sleep days ${Math.round(hi * 100)}%. Sleep shows in the mood.`;
    else if (lo - hi >= 0.25) reading = `The happier days were not the longer-sleep days this week; something else sets the mood more than sleep right now.`;
    else reading = `Mood and sleep moved together only loosely this week.`;
  }
  const dayName = (day: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
  return (
    <section className="card" aria-labelledby="moodp-h">
      <h2 id="moodp-h" className="font-semibold">
        Mood and sleep
      </h2>
      <p className="muted text-sm">{reading ?? "Tap the mood a few times a day for three days or more and the pattern shows here."}</p>
      <ul className="mt-1 flex flex-col">
        {rows.map((r) => (
          <li key={r.day} className="row">
            <span className="w-16 shrink-0 font-semibold">{dayName(r.day)}</span>
            <span className="min-w-0 flex-1 truncate text-lg leading-tight">{r.faces || <span className="muted text-sm">no taps</span>}</span>
            <span className="muted shrink-0 text-sm tabular-nums">{r.sleepMin ? `slept ${fmtDuration(Math.round(r.sleepMin))}` : ""}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
