import Link from "next/link";
import type { EntryRow, HomeSummary } from "@/lib/types";
import { sleepDay } from "@/lib/sleep-day";
import { fmtTime, zonedMidnight } from "@/lib/time";
import { nightWindow } from "@/lib/night";
import { stageFor } from "@/lib/stage";
import { stripCells } from "@/lib/logged";
import { pottyCount, type DayPlan } from "@/lib/day";

/**
 * Home's day in up to three counts (DESIGN.md, "Stat strip"): naps, feeds and diapers so far,
 * one number over one word. Naps and feeds are links and look like links ("naps ›" opens the
 * Sleep section, "feeds ›" the Feeds section): until 24 November the way to the two sections
 * was below the first screen. When she woke is on the Sleep today card below, and what is
 * usual at her age on the Sleep section, so neither is repeated here. The last of each is on
 * the rows themselves.
 * From 12 months a cell shows only for what the family logs (lib/logged.ts, R8): naps while a
 * nap is expected or one was had today, feeds and diapers when logged lately. With a saved day
 * (lib/day.ts) the day names the cells: meals or the potty may take a place, and the naps are
 * held against the family's own answer ("1 of 2"), which stays; what is only usual at an age
 * does not.
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
  const stage = stageFor(summary.subject.birth_date, now, timezone);
  const cells = stripCells({
    stage,
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
  // "woke" counts towards whether there is a strip (lib/logged.ts) and is drawn on the card below.
  const shown = (cells ?? []).filter((c) => c.kind !== "woke");
  if (!shown.length) return null;
  const HREF: Partial<Record<(typeof shown)[number]["kind"], string>> = { naps: "/baby/sleep", feeds: "/baby/feed" };
  const held = stage.toddler && !!plan?.cells && !!plan.usualNaps;
  return (
    <div className="card day-strip" style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` }} role="group" aria-label="Today so far">
      {shown.map((c) => {
        // A plain count, unless the family said how many naps there are: then "1 of 2", as stripCells wrote it.
        const plain = c.kind === "naps" && !held;
        const value = plain ? `${s.naps}` : c.value;
        const word = plain ? (s.naps === 1 ? "nap" : "naps") : c.label;
        const href = HREF[c.kind];
        const inner = (
          <>
            <span className="day-num">{value}</span>
            <span className="day-word">{href ? `${word} ›` : word}</span>
          </>
        );
        return href ? (
          <Link key={c.kind} prefetch={false} href={href} className="day-cell" aria-label={`${value} ${word} today. ${c.kind === "naps" ? "All sleep" : "All feeds"}`}>
            {inner}
          </Link>
        ) : (
          <span key={c.kind} className="day-cell">
            {inner}
          </span>
        );
      })}
    </div>
  );
}
