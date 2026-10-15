import type { DayStats, EntryRow } from "@/lib/types";

const FACE: Record<string, string> = { Happy: "😊", Calm: "😌", Fussy: "😣", Unsettled: "😢" };
const GOOD = new Set(["Happy", "Calm"]);

/**
 * Mood against sleep, day by day: the faces tapped each day beside how much
 * she slept, and the plain reading of the two together.
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
    if (hi - lo >= 0.25) reading = `On her shorter-sleep days ${Math.round(lo * 100)}% of taps were happy or calm; on longer-sleep days ${Math.round(hi * 100)}%. Sleep shows in her mood.`;
    else if (lo - hi >= 0.25) reading = `Her happier days were not her longer-sleep days this week; something else sets her mood more than sleep right now.`;
    else reading = `Mood and sleep moved together only loosely this week.`;
  }
  const fmt = (min: number | null) => (min == null ? "" : `${Math.floor(min / 60)} h ${min % 60 ? `${min % 60} min` : ""}`.trim());
  return (
    <section className="card" aria-labelledby="moodp-h">
      <h2 id="moodp-h" className="font-semibold">
        Mood and sleep
      </h2>
      <table className="mt-1 w-full text-sm">
        <thead className="muted text-xs">
          <tr>
            <th className="text-left font-normal">Day</th>
            <th className="text-left font-normal">Taps</th>
            <th className="text-right font-normal">Sleep</th>
            <th className="text-right font-normal">Night</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.day}>
              <td className="py-0.5">{r.day.slice(5)}</td>
              <td className="text-lg leading-tight">{r.faces || <span className="muted text-sm">·</span>}</td>
              <td className="text-right">{fmt(r.sleepMin)}</td>
              <td className="muted text-right">{fmt(r.nightMin)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted mt-2 text-sm">{reading ?? "Tap her mood a few times a day for three days or more and the pattern shows here."}</p>
    </section>
  );
}
