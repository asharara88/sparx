import type { EntryRow } from "@/lib/types";
import { dateWords, zonedMidnight } from "@/lib/time";

/**
 * Two weeks at a glance: one thin 24-hour bar per day. Sleep is the dark band, night
 * wake-ups the light one, feeds are ticks (bottles lighter), diapers dots below. Patterns
 * (when the long night stretch starts, how naps cluster) show up without numbers.
 */
export function PatternBars({ entries, days, timezone, today }: { entries: EntryRow[]; days: string[]; timezone: string; today: string }) {
  const H = 14;
  const W = 1440;
  const rows = days.map((day) => {
    const start = zonedMidnight(day, timezone).getTime();
    const end = start + 86_400_000;
    const nowClip = day === today ? Math.min(end, Date.now()) : end;
    const minute = (ms: number) => Math.max(0, Math.min(W, (ms - start) / 60000));
    const clip = (e: EntryRow): [number, number] | null => {
      const a = new Date(e.occurred_at).getTime();
      const b = e.ended_at ? new Date(e.ended_at).getTime() : nowClip;
      if (b < start || a >= end) return null;
      return [minute(a), minute(b)];
    };
    const inDay = (e: EntryRow) => {
      const t = new Date(e.occurred_at).getTime();
      return t >= start && t < end;
    };
    return {
      day,
      sleeps: entries.filter((e) => e.type_id === "lana.sleep").map(clip).filter((x): x is [number, number] => !!x),
      wakes: entries.filter((e) => e.type_id === "lana.wake").map(clip).filter((x): x is [number, number] => !!x),
      feeds: entries.filter((e) => e.type_id === "lana.feed" && inDay(e)).map((e) => ({ at: minute(new Date(e.occurred_at).getTime()), bottle: e.payload.method === "Bottle" })),
      diapers: entries.filter((e) => e.type_id === "lana.diaper" && inDay(e)).map((e) => minute(new Date(e.occurred_at).getTime())),
    };
  });
  const label = (day: string) => dateWords(new Date(day + "T12:00:00Z"), { weekday: "short", day: "numeric", timeZone: "UTC" });
  return (
    <section className="card">
      <h2 className="font-semibold">Patterns, last {days.length} days</h2>
      <p className="muted text-sm">Dark is sleep, pale is awake in the night, ticks are feeds (lighter for bottles), dots are diapers. Midnight to midnight.</p>
      <div className="mt-3 flex flex-col gap-1">
        {rows.map((r) => (
          <div key={r.day} className="flex items-center gap-2">
            <span className="muted w-12 shrink-0 text-right text-xs tabular-nums">{label(r.day)}</span>
            <svg viewBox={`0 0 ${W} ${H + 6}`} className="h-5 w-full" preserveAspectRatio="none" aria-label={`${r.day}: ${r.sleeps.length} sleeps, ${r.feeds.length} feeds`}>
              <rect x={0} y={0} width={W} height={H} rx={3} fill="var(--card-2)" />
              {[360, 720, 1080].map((x) => (
                <line key={x} x1={x} x2={x} y1={0} y2={H} stroke="var(--line)" strokeWidth={2} />
              ))}
              {r.wakes.map(([a, b], i) => (
                <rect key={`w${i}`} x={a} y={0} width={Math.max(4, b - a)} height={H} fill="var(--accent-soft)" />
              ))}
              {r.sleeps.map(([a, b], i) => (
                <rect key={`s${i}`} x={a} y={0} width={Math.max(4, b - a)} height={H} rx={2} fill="var(--accent)" />
              ))}
              {r.feeds.map((f, i) => (
                <rect key={`f${i}`} x={f.at - 3} y={0} width={6} height={H} fill={f.bottle ? "var(--warn)" : "var(--ok)"} />
              ))}
              {r.diapers.map((d, i) => (
                <circle key={`d${i}`} cx={d} cy={H + 3} r={3} fill="var(--muted)" />
              ))}
            </svg>
          </div>
        ))}
      </div>
      <div className="muted mt-1 flex justify-between pl-14 text-xs">
        <span>0</span>
        <span>6</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>
    </section>
  );
}
