import type { EntryRow, HomeSummary } from "@/lib/types";
import { sleepDay } from "@/lib/sleep-day";
import { fmtTime, zonedMidnight } from "@/lib/time";
import { nightWindow } from "@/lib/night";
import { range, stageFor } from "@/lib/stage";

/**
 * Home's day in four numbers (DESIGN.md, "Stat strip"): when she woke, naps against what is
 * usual at her age, feeds and nappies so far. One white bar; tapping it goes to the day's
 * cards below the log rows. The last of each is on the rows themselves, so not repeated here.
 */
export function TodayStrip({ summary, entries, day, timezone, nowIso }: { summary: HomeSummary; entries: EntryRow[]; day: string; timezone: string; nowIso: string }) {
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
  const usual = stageFor(summary.subject.birth_date, now).naps;
  const feeds = summary.today_counts?.["lana.feed"] ?? 0;
  const nappies = summary.today_counts?.["lana.diaper"] ?? 0;
  const cells = [
    { value: s.wokeAt ? fmtTime(new Date(s.wokeAt).toISOString(), timezone) : "—", label: "woke" },
    { value: usual[1] ? `${s.naps} of ${range(usual)}` : `${s.naps}`, label: "naps" },
    { value: `${feeds}`, label: feeds === 1 ? "feed" : "feeds" },
    { value: `${nappies}`, label: nappies === 1 ? "nappy" : "nappies" },
  ];
  return (
    <a href="#today" className="card row-link grid grid-cols-4 gap-1 py-3 text-center no-underline" aria-label="Today so far, more below">
      {cells.map((c) => (
        <span key={c.label} className="flex flex-col">
          <span className="text-lg font-bold leading-tight tabular-nums">{c.value}</span>
          <span className="muted text-[13px]">{c.label}</span>
        </span>
      ))}
    </a>
  );
}
