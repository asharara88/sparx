import Link from "next/link";
import type { EntryRow } from "@/lib/types";
import { fmtDuration, zonedMidnight } from "@/lib/time";
import { longestSleep } from "@/lib/backlog";

const H = 432; // 24 hours, 18 px an hour

/**
 * The week as 24-hour columns (Huckleberry's schedule view): a column per day, midnight at
 * the top, sleep as lilac blocks and feeds as pink ticks, a line for now. The title says
 * the answer ("Longest sleep 6 h 40 min, up from 5 h"). A whole column is the tap target:
 * it opens that day's list, where each entry opens its edit sheet.
 */
export function WeekColumns({ entries, days, prevDays, timezone, today }: { entries: EntryRow[]; days: string[]; prevDays: string[]; timezone: string; today: string }) {
  const now = Date.now();
  const startOf = (d: string) => zonedMidnight(d, timezone).getTime();
  const weekFrom = startOf(days[0]);
  const weekTo = startOf(days[days.length - 1]) + 86_400_000;
  const best = longestSleep(entries, weekFrom, weekTo, now);
  const before = prevDays.length ? longestSleep(entries, startOf(prevDays[0]), weekFrom, now) : 0;
  const title = !best ? "No sleeps logged this week" : `Longest sleep ${fmtDuration(best)}${before && before !== best ? `, ${best > before ? "up" : "down"} from ${fmtDuration(before)}` : ""}`;

  const cols = days.map((day) => {
    const start = startOf(day);
    const end = start + 86_400_000;
    const clipTo = day === today ? Math.min(end, now) : end;
    const y = (ms: number) => Math.round(((Math.min(end, Math.max(start, ms)) - start) / 86_400_000) * H);
    const sleeps = entries
      .filter((e) => e.type_id === "lana.sleep")
      .map((e) => [Date.parse(e.occurred_at), e.ended_at ? Date.parse(e.ended_at) : clipTo] as const)
      .filter(([a, b]) => b > start && a < end && b - a < 16 * 3_600_000)
      .map(([a, b]) => ({ top: y(a), h: Math.max(4, y(b) - y(a)) }));
    const feeds = entries.filter((e) => e.type_id === "lana.feed" && Date.parse(e.occurred_at) >= start && Date.parse(e.occurred_at) < end).map((e) => y(Date.parse(e.occurred_at)));
    const sleepMin = sleeps.reduce((s, b) => s + Math.round((b.h / H) * 1440), 0);
    const name = new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
    return { day, sleeps, feeds, isToday: day === today, nowY: day === today ? y(now) : null, letter: name.slice(0, 2), label: `${name}: ${fmtDuration(sleepMin)} sleep, ${feeds.length} feeds` };
  });

  return (
    <section className="flex flex-col gap-2" aria-labelledby="wk-h">
      <div>
        <h2 id="wk-h" className="font-[family-name:var(--font-display)] text-xl font-semibold">
          {title}
        </h2>
        <p className="muted text-sm">The last 7 days, midnight at the top. Tap a day to see it.</p>
      </div>
      <div className="card flex gap-1.5 py-3 pl-1 pr-2">
        <div className="relative w-7 shrink-0 text-[0.8rem] tabular-nums text-[var(--muted)]" style={{ height: H }} aria-hidden>
          {["00", "06", "12", "18", "24"].map((t, i) => (
            <span key={t} className="absolute right-1" style={{ top: Math.min(H - 16, Math.max(0, (i * H) / 4 - 8)) }}>
              {t}
            </span>
          ))}
        </div>
        <div className="grid flex-1 grid-cols-7 gap-1">
          {cols.map((c) => (
            <Link key={c.day} href={`/baby?tab=today&d=${c.day}`} aria-label={c.label} className="flex min-w-0 flex-col items-stretch gap-1 no-underline">
              <span className={`week-col ${c.isToday ? "week-col-today" : ""}`} style={{ height: H }} aria-hidden>
                {c.sleeps.map((b, i) => (
                  <span key={`s${i}`} className="week-sleep" style={{ top: b.top, height: b.h }} />
                ))}
                {c.feeds.map((t, i) => (
                  <span key={`f${i}`} className="week-feed" style={{ top: t - 2 }} />
                ))}
                {c.nowY != null && <span className="week-now" style={{ top: c.nowY }} />}
              </span>
              <span className={`text-center text-[0.8rem] ${c.isToday ? "font-extrabold text-[var(--accent)]" : "muted font-semibold"}`}>{c.letter}</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
