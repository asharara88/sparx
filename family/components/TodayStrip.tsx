import type { EntryRow, HomeSummary } from "@/lib/types";
import { sleepDay } from "@/lib/sleep-day";
import { fmtTime, zonedMidnight } from "@/lib/time";
import { nightWindow } from "@/lib/night";
import { stageFor } from "@/lib/stage";
import { stripCells } from "@/lib/logged";
import { pottyCount, type DayPlan } from "@/lib/day";

// Written out in full so Tailwind keeps all three.
const COLS: Record<number, string> = { 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4" };

/**
 * Home's day in up to four numbers (DESIGN.md, "Stat strip"): when she woke, naps against what
 * is usual at her age, feeds and diapers so far. One white bar; tapping it goes to the day's
 * cards below the log rows. The last of each is on the rows themselves, so not repeated here.
 * From 12 months a cell shows only for what the family logs (lib/logged.ts, R8): naps while a
 * nap is expected or one was had today, feeds and diapers when logged lately; with fewer than
 * two cells there is no strip. With a saved day (lib/day.ts) the day names the cells: the naps
 * are held against the family's answer, and meals or the potty may take a place.
 */
export function TodayStrip({ summary, entries, day, timezone, nowIso, napExpected, plan = null }: { summary: HomeSummary; entries: EntryRow[]; day: string; timezone: string; nowIso: string; /** napPattern's answer for today; not read for a baby. */ napExpected: boolean; /** The home's plan (lib/day.ts dayPlan). Absent, or with no saved day, the strip is as it always was. */ plan?: Pick<DayPlan, "cells" | "usualNaps"> | null }) {
  const start = zonedMidnight(day, timezone).getTime();
  const now = Date.parse(nowIso);
  const hourOf = (ms: number) => {
    const p = new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "numeric", hourCycle: "h23", timeZone: timezone }).format(new Date(ms)).split(":");
    return Number(p[0]) + Number(p[1]) / 60;
  };
  const hours = (hhmm: string, fallback: number) => {
    const n = Number(hhmm.slice(0, 2)) + Number(hhmm.slice(3, 5) || 0) / 60;
    return Number.isFinite(n) ? n : fallback;
  };
  const night = nightWindow(summary.subject.settings);
  const s = sleepDay(entries, start, now, { bedtimeHour: hours(night.from, 19), morningHour: hours(night.to, 7), hourOf });
  const cells = stripCells({
    stage: stageFor(summary.subject.birth_date, now, timezone),
    woke: s.wokeAt ? fmtTime(new Date(s.wokeAt).toISOString(), timezone) : "—",
    naps: s.naps,
    napExpected,
    feeds: summary.today_counts?.["lana.feed"] ?? 0,
    diapers: summary.today_counts?.["lana.diaper"] ?? 0,
    lastFeedAt: summary.last["lana.feed"]?.occurred_at ?? null,
    lastDiaperAt: summary.last["lana.diaper"]?.occurred_at ?? null,
    today: day,
    tz: timezone,
    // Today's meals and potty by the same day as the counts above (home_summary's today).
    plan: plan ? { cells: plan.cells, usualNaps: plan.usualNaps, meals: summary.today_counts?.["lana.meal"] ?? 0, potty: pottyCount(summary.today_entries ?? []) } : undefined,
  });
  if (!cells) return null;
  return (
    <a href="#today" className={`card row-link grid ${COLS[cells.length]} gap-1 py-3 text-center no-underline`} aria-label="Today so far, more below">
      {cells.map((c) => (
        <span key={c.label} className="flex flex-col">
          {/* One line always ("3 of 3–4" broke in two at 320 px); a narrow phone gets a size smaller. */}
          <span className="whitespace-nowrap text-[clamp(0.95rem,4.6vw,1.125rem)] font-bold leading-tight tabular-nums">{c.value}</span>
          <span className="muted text-[13px]">{c.label}</span>
        </span>
      ))}
    </a>
  );
}
