/**
 * Days of a toddler's log for the toddler tests (lib/toddler.test.ts, lib/toddler-days.test.ts),
 * built by plain arithmetic as the golden test builds a baby's, and what Home makes of them
 * through the library's own functions.
 *
 * The clock is the golden test's: 17 November 2026 in Asia/Dubai. Every time is minutes from
 * 00:00 that day; earlier days are negative. The four families are the ones of WALK.md and
 * supabase/tests/toddler_homes.sql (Noor 380 days, Adam 563, Maya 746, Yusuf 1111), with one
 * difference: tonight's night sleep is logged as a running timer once it has started, as a
 * family logs it (the seed logs only finished entries, so it never has tonight's sleep).
 */
import type { EntryRow } from "../types.ts";
import { feedGapFor, stageOf } from "../stage.ts";
import { ageDays as daysOld } from "../norms.ts";
import { napPattern, nextNap, topCard, type NapPattern, type NextNap, type TopCard } from "../child-insights.ts";
import { feedCard, stripCells, type FeedCardText, type StripCell } from "../logged.ts";
import { sleepDay } from "../sleep-day.ts";
import { tipsFor, type Tip } from "../child-guide.ts";
import { checkEntries, type CheckFlag } from "../entry-checks.ts";
import { fmtDuration, fmtTime } from "../time.ts";

export const TZ = "Asia/Dubai";
export const TODAY = "2026-11-17";
export const MIN = 60_000;
/** Minutes in a day. */
export const DAY = 1440;
/** 00:00 on 17 November 2026 in Dubai (4 hours ahead of UTC all year). */
export const DAY0 = Date.UTC(2026, 10, 16, 20, 0);

/** Day `day` at "HH:MM", as minutes from DAY0. */
export const at = (day: number, hhmm: string) => day * DAY + Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
export const msOf = (t: number) => DAY0 + Math.round(t * MIN);
export const iso = (t: number) => new Date(msOf(t)).toISOString();
/** The calendar day `day` days from today, YYYY-MM-DD. */
export const ymd = (day: number) => new Date(Date.UTC(2026, 10, 17 + day)).toISOString().slice(0, 10);
/** The birth date that makes a child `age` days old today. */
export const bornAgo = (age: number) => ymd(-age);

export type Kind = "feed" | "sleep" | "diaper" | "meal" | "pump" | "note" | "wake";
export interface Draft {
  kind: Kind;
  start: number;
  end: number | null;
  payload: Record<string, unknown>;
  note?: string | null;
}

export const sleep = (start: number, end: number | null): Draft => ({ kind: "sleep", start, end, payload: { place: "Cot" } });
export const bottle = (start: number, ml: number, milk = "Formula"): Draft => ({ kind: "feed", start, end: start + 10, payload: { method: "Bottle", amount_ml: ml, milk } });
export const breast = (start: number, min: number, side = "Left"): Draft => ({ kind: "feed", start, end: start + min, payload: { method: "Breast", side, duration_min: min } });
export const diaper = (start: number, kind = "Wet"): Draft => ({ kind: "diaper", start, end: null, payload: { kind } });
export const meal = (start: number, food = "porridge"): Draft => ({ kind: "meal", start, end: null, payload: { food } });
export const pump = (start: number, ml: number): Draft => ({ kind: "pump", start, end: null, payload: { amount_ml: ml } });
export const note = (start: number, text: string): Draft => ({ kind: "note", start, end: null, payload: {}, note: text });

/**
 * One day's rows, repeated: [kind, day offset of the start, "HH:MM", day offset of the end or
 * null, "HH:MM" or null, payload], as in toddler_homes.sql. A night written as (-1, "19:30",
 * 0, "06:45") belongs to the morning it ends on.
 */
export type Row = [Kind, number, string, number | null, string | null, Record<string, unknown>];

/** The rows of every day from `from` to `to` (day offsets, `from` the earliest). */
export function everyDay(rows: Row[], from: number, to: number): Draft[] {
  const out: Draft[] = [];
  for (let d = from; d <= to; d++) for (const [kind, d1, t1, d2, t2, payload] of rows) out.push({ kind, start: at(d + d1, t1), end: d2 == null ? null : at(d + d2!, t2!), payload });
  return out;
}

/**
 * The log as the app lists it at `now`: entries started by then, newest first, from the last
 * `days` x 24 hours (Home's week is 7). A timer that ends later is still running.
 */
export function readAt(drafts: Draft[], now: number, days = 7): EntryRow[] {
  return drafts
    .filter((d) => d.start <= now && d.start >= now - days * DAY)
    .sort((a, b) => b.start - a.start || (a.kind < b.kind ? -1 : 1))
    .map((d, i) => ({ id: `${d.kind}:${d.start}:${i}`, type_id: `lana.${d.kind}`, type_label: d.kind, icon: null, occurred_at: iso(d.start), ended_at: d.end == null || d.end > now ? null : iso(d.end), payload: d.payload, note: d.note ?? null }));
}

export interface Family {
  name: string;
  sex: string;
  ageDays: number;
  rows: Row[];
}

/** WALK.md's four families and their normal week (supabase/tests/toddler_homes.sql). */
export const FAMILIES: Record<"noor" | "adam" | "maya" | "yusuf", Family> = {
  // 12 months: two naps, a bottle of formula morning and evening, meals and a snack, diapers.
  noor: {
    name: "Noor", sex: "Girl", ageDays: 380,
    rows: [
      ["sleep", -1, "19:30", 0, "06:45", {}], ["feed", 0, "07:00", 0, "07:10", { method: "Bottle", milk: "Formula", amount_ml: 180 }], ["diaper", 0, "07:05", null, null, { kind: "Wet" }],
      ["meal", 0, "07:45", null, null, {}], ["sleep", 0, "09:45", 0, "11:00", {}], ["diaper", 0, "11:05", null, null, { kind: "Dirty" }], ["meal", 0, "12:00", null, null, {}],
      ["sleep", 0, "14:30", 0, "15:45", {}], ["diaper", 0, "15:50", null, null, { kind: "Wet" }], ["meal", 0, "16:00", null, null, {}], ["meal", 0, "17:45", null, null, {}],
      ["feed", 0, "18:45", 0, "18:55", { method: "Bottle", milk: "Formula", amount_ml: 200 }], ["diaper", 0, "19:15", null, null, { kind: "Wet" }],
    ],
  },
  // 18 months: one nap, no bottle, meals and snacks, diapers.
  adam: {
    name: "Adam", sex: "Boy", ageDays: 563,
    rows: [
      ["sleep", -1, "19:45", 0, "07:00", {}], ["diaper", 0, "07:15", null, null, { kind: "Wet" }], ["meal", 0, "07:30", null, null, {}], ["meal", 0, "10:00", null, null, {}],
      ["diaper", 0, "10:30", null, null, { kind: "Dirty" }], ["meal", 0, "11:45", null, null, {}], ["sleep", 0, "12:30", 0, "14:30", {}], ["diaper", 0, "14:45", null, null, { kind: "Wet" }],
      ["meal", 0, "15:30", null, null, {}], ["meal", 0, "18:00", null, null, {}], ["diaper", 0, "19:30", null, null, { kind: "Wet" }],
    ],
  },
  // 24 months: one nap, meals and snacks, diapers part of the time.
  maya: {
    name: "Maya", sex: "Girl", ageDays: 746,
    rows: [
      ["sleep", -1, "20:00", 0, "07:00", {}], ["diaper", 0, "07:15", null, null, { kind: "Wet" }], ["meal", 0, "07:30", null, null, {}], ["meal", 0, "10:00", null, null, {}],
      ["meal", 0, "12:00", null, null, {}], ["sleep", 0, "13:00", 0, "14:30", {}], ["diaper", 0, "14:40", null, null, { kind: "Wet" }], ["meal", 0, "15:30", null, null, {}],
      ["meal", 0, "18:00", null, null, {}], ["diaper", 0, "19:45", null, null, { kind: "Wet" }],
    ],
  },
  // 36 months: no nap, four meals, no diapers.
  yusuf: {
    name: "Yusuf", sex: "Boy", ageDays: 1111,
    rows: [["sleep", -1, "19:45", 0, "07:00", {}], ["meal", 0, "07:30", null, null, {}], ["meal", 0, "12:00", null, null, {}], ["meal", 0, "15:30", null, null, {}], ["meal", 0, "18:00", null, null, {}]],
  },
};

/** A family's normal week: the seed's eight days (7 days ago to today) and tonight's sleep once it has started. */
export const familyLog = (f: Family) => everyDay(f.rows, -7, 1).filter((d) => d.start < at(1, "00:00"));

const hourFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "numeric", minute: "numeric", hourCycle: "h23" });
/** The hour of an instant on the home's clock, as a fraction (19.5 is 19:30). */
export const hourOf = (isoAt: string) => {
  const p = hourFmt.formatToParts(new Date(isoAt));
  return Number(p.find((x) => x.type === "hour")?.value ?? 0) + Number(p.find((x) => x.type === "minute")?.value ?? 0) / 60;
};
const time = (isoOrMs: string | number) => fmtTime(typeof isoOrMs === "number" ? new Date(isoOrMs).toISOString() : isoOrMs, TZ);

/** Home's top card in the words HomeState draws, on one line. */
export function cardWords(c: TopCard, they: string): string {
  switch (c.kind) {
    case "feeding": return `Feeding since ${time(c.since)}`;
    case "asleep": return `Asleep since ${time(c.since)}`;
    case "window": return `${c.label} ${time(c.from)} – ${time(c.to)}, up since ${time(c.woke)}. ${c.say}`;
    case "last_woke": return `Last woke ${time(c.woke)}. If ${they} napped since, log it below.`;
    case "awake": return `Awake for ${fmtDuration(c.awakeMin)}, since ${time(c.woke)}`;
    case "nothing": return "Tap below, or tell me what happened.";
  }
}

/** The strip on one line ("06:45 woke · 0 of 1–2 naps · 1 feed"), or "no strip". */
export const stripWords = (cells: StripCell[] | null) => (cells ? cells.map((c) => `${c.value} ${c.label}`).join(" · ") : "no strip");

export interface HomeView {
  week: EntryRow[];
  pattern: NapPattern;
  nap: NextNap | null;
  card: string;
  strip: string;
  feeds: FeedCardText;
  tips: Tip[];
  checks: CheckFlag[];
}

/** What Home makes of a child's log at `now` (minutes from DAY0), through the library's functions, as app/(app)/page.tsx calls them. */
export function homeAt(child: { ageDays: number; sex: string | null; name: string }, drafts: Draft[], now: number): HomeView {
  const nowMs = msOf(now);
  const week = readAt(drafts, now);
  const birth = bornAgo(child.ageDays);
  const ageDays = daysOld(birth, TODAY);
  const stage = stageOf(ageDays);
  const pattern = napPattern(week, ageDays, nowMs, TZ, nowMs - 7 * DAY * MIN);
  const nap = nextNap(week, ageDays, nowMs, hourOf, pattern);
  const open = week.find((e) => e.type_id === "lana.sleep" && !e.ended_at && nowMs - Date.parse(e.occurred_at) < 24 * 3_600_000);
  const feeding = week.find((e) => e.type_id === "lana.feed" && !e.ended_at && e.payload.method !== "Bottle");
  const lastSleep = week.find((e) => e.type_id === "lana.sleep");
  const card = topCard({ stage, feedingSince: feeding?.occurred_at ?? null, asleepSince: open?.occurred_at ?? null, woke: lastSleep?.ended_at ?? null, nap: nap?.at != null ? { at: nap.at, isBedtime: nap.isBedtime } : null, now: nowMs });
  const dayStart = msOf(at(0, "00:00"));
  const s = sleepDay(week, dayStart, nowMs, { bedtimeHour: 19, morningHour: 7, hourOf: (m) => hourOf(new Date(m).toISOString()) });
  const lastOf = (type: string) => week.find((e) => e.type_id === type)?.occurred_at ?? null;
  const today = (type: string) => week.filter((e) => e.type_id === type && Date.parse(e.occurred_at) >= dayStart);
  const strip = stripCells({ stage, woke: s.wokeAt ? time(s.wokeAt) : "—", naps: s.naps, napExpected: pattern.expected, feeds: today("lana.feed").length, diapers: today("lana.diaper").length, lastFeedAt: lastOf("lana.feed"), lastDiaperAt: lastOf("lana.diaper"), today: TODAY, tz: TZ });
  // home_summary's next_due: a baby's last feed end plus the gap for the age; none for a toddler (R2).
  const lastFeed = week.find((e) => e.type_id === "lana.feed");
  const nextDue = stage.milkClock && lastFeed ? new Date(Date.parse(lastFeed.ended_at ?? lastFeed.occurred_at) + feedGapFor(stage, 180) * MIN).toISOString() : null;
  const feeds = feedCard({ ageDays, feeding: !!feeding, nextDue, todayFeeds: today("lana.feed"), lastFeedAt: lastOf("lana.feed"), today: TODAY, tz: TZ, now: nowMs });
  const tips = tipsFor(week, birth, nowMs, { timezone: TZ, feedGapMin: 180, name: child.name, sex: child.sex });
  const checks = checkEntries(week, { now: nowMs, ageDays });
  const they = child.sex === "Girl" ? "she" : child.sex === "Boy" ? "he" : "they";
  return { week, pattern, nap, card: cardWords(card, they), strip: stripWords(strip), feeds, tips, checks };
}
