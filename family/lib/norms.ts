import { fmtDuration } from "./time.ts";
import { currentMonth } from "./story.ts";
import { isToddler } from "./stage.ts";
/**
 * Typical daily ranges for a healthy term baby, by age. General guidance from
 * the NHS, the American Academy of Pediatrics and the National Sleep
 * Foundation, rounded to whole numbers. They are for a quick glance, not a
 * diagnosis: a day that looks short is just as often a day that was not fully
 * written down.
 *
 * From 12 months there is no usual number of feeds, bottle millilitres or
 * diapers (null): a toddler's milk and diapers vary too much, and a family may
 * not log them at all. Sleep keeps a usual range (AASM, WHO) but is never flagged.
 */
export interface Norm {
  low: number;
  high: number;
  /** When true a value under `low` is worth a flag; otherwise it is only shown. */
  flagLow: boolean;
  note?: string;
}
export interface AgeNorms {
  /** The row, as the doctor's guide names it: "3 to 6 months". */
  label: string;
  /** Null from 12 months: no usual number at that age. */
  feeds: Norm | null;
  /** Only when the day was bottles only (ml per day). Null from 12 months. */
  bottleMl: Norm | null;
  wet: Norm | null;
  dirty: Norm | null;
  sleepMin: Norm;
  nightSleepMin: Norm;
}

/** The note on a row that has no usual number (from 12 months). */
export const NO_USUAL = "No usual number at this age.";

export function ageDays(birthDate: string, day: string): number {
  return Math.floor((Date.parse(day) - Date.parse(birthDate)) / 86_400_000);
}

/**
 * The age from a number of days alone, for where no birth date is at hand: "12 days",
 * "9 weeks", "5 months", from 24 months "2 years", "2 years 3 months". With a birth date,
 * ageWords counts calendar months instead.
 */
export function ageLabel(days: number): string {
  if (days < 0) return "not born yet";
  if (days < 14) return `${days} day${days === 1 ? "" : "s"}`;
  const weeks = Math.floor(days / 7);
  if (days < 7 * 16) return `${weeks} weeks`;
  const months = Math.floor(days / 30.4375);
  return months < 24 ? `${months} month${months === 1 ? "" : "s"}` : years(months, false);
}

/** 26 months: "2 years 2 months"; short, "2 years". */
function years(months: number, short: boolean): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  return `${y} year${y === 1 ? "" : "s"}${m && !short ? ` ${m} month${m === 1 ? "" : "s"}` : ""}`;
}

/** Whole months since birth on `day`: a month is complete on the same day of the month, or the last day of a shorter month (as Story counts). */
function monthsOld(birthDate: string, day: string): number {
  return currentMonth(birthDate.slice(0, 10), day) - 1;
}

/**
 * The child's age on `day` in words, for every screen that has the birth date: days under
 * 14 days and weeks under 16 weeks as ageLabel, then whole calendar months ("4 months",
 * "18 months"; a birthday says the new month, not one short), and from 24 months years
 * ("2 years", "2 years 3 months").
 */
export function ageWords(birthDate: string, day: string): string {
  const days = ageDays(birthDate, day);
  if (days < 7 * 16) return ageLabel(days);
  const months = monthsOld(birthDate, day);
  return months < 24 ? `${months} month${months === 1 ? "" : "s"}` : years(months, false);
}

/** Home's header: as ageWords, but whole years only from 24 months ("2 years"), so the line still fits. */
export function ageWordsShort(birthDate: string, day: string): string {
  const days = ageDays(birthDate, day);
  if (days < 7 * 16) return ageLabel(days);
  const months = monthsOld(birthDate, day);
  return months < 24 ? ageWords(birthDate, day) : years(months, true);
}

export function normsForAge(days: number): AgeNorms {
  const months = days / 30.4375;
  const n = (low: number, high: number, flagLow = true, note?: string): Norm => ({ low, high, flagLow, note });
  if (months < 1) {
    return {
      label: "First month",
      feeds: n(8, 12),
      bottleMl: n(450, 720),
      wet: n(6, 8, days >= 5),
      dirty: n(3, 6, days >= 5),
      sleepMin: n(14 * 60, 17 * 60),
      nightSleepMin: n(8 * 60, 9 * 60, false, "Broken into short stretches at this age."),
    };
  }
  if (months < 3) {
    return {
      label: "1 to 3 months",
      feeds: n(7, 9),
      bottleMl: n(600, 900),
      wet: n(6, 8),
      dirty: n(0, 4, days < 42, "After six weeks a breastfed baby can skip days."),
      sleepMin: n(14 * 60, 17 * 60),
      nightSleepMin: n(8 * 60, 10 * 60, false),
    };
  }
  if (months < 6) {
    return {
      label: "3 to 6 months",
      feeds: n(6, 8),
      bottleMl: n(720, 960),
      wet: n(6, 8),
      dirty: n(0, 4, false, "A breastfed baby can skip days."),
      sleepMin: n(12 * 60, 15 * 60),
      nightSleepMin: n(9 * 60, 11 * 60, false),
    };
  }
  if (months < 12) {
    return {
      label: "6 to 12 months",
      feeds: n(4, 6, true, "Plus solids."),
      bottleMl: n(600, 900),
      wet: n(5, 7),
      dirty: n(1, 2, false),
      sleepMin: n(12 * 60, 15 * 60),
      nightSleepMin: n(10 * 60, 12 * 60, false),
    };
  }
  // AASM consensus (endorsed by the AAP) and the WHO: 11 to 14 h at 1 to 2 years, 10 to 13 h at 3 to 5.
  if (months < 36) {
    return { label: "12 to 35 months", feeds: null, bottleMl: null, wet: null, dirty: null, sleepMin: n(11 * 60, 14 * 60, false), nightSleepMin: n(10 * 60, 12 * 60, false) };
  }
  return { label: "3 years and over", feeds: null, bottleMl: null, wet: null, dirty: null, sleepMin: n(10 * 60, 13 * 60, false), nightSleepMin: n(10 * 60, 12 * 60, false) };
}

/** The line under the rows of "against her age": where the ranges come from. */
export function normsSource(days: number): string {
  return !isToddler(days)
    ? "Ranges from the NHS, the AAP and the National Sleep Foundation. Only what was logged counts. Not medical advice."
    : "Sleep ranges from the AASM and the WHO. Only what was logged counts. Not medical advice.";
}

export type Verdict = "short" | "ok" | "more" | "so_far";

export interface CheckRow {
  key: string;
  label: string;
  value: string;
  typical: string;
  verdict: Verdict;
  note?: string;
}

export interface DayTotals {
  breast_count: number;
  bottle_count: number;
  bottle_ml: number;
  diapers_wet: number;
  diapers_dirty: number;
  sleep_min: number;
  night_sleep_min: number;
}

/** The kinds of entry a number comes from. */
export type LogKind = "feed" | "diaper" | "sleep";
/** Which kinds were logged in the period: from 12 months a kind with no logged day gets no row. */
export type LoggedKinds = Record<LogKind, boolean>;

// "5 h 40 min", never "5.7 h" (DESIGN.md, Numbers); a per-day average keeps one decimal at most.
const hours = (min: number) => (Math.round(min) > 0 ? fmtDuration(Math.round(min)) : "—");
const count = (n: number) => (Number.isInteger(n) ? `${n}` : n.toFixed(1).replace(/\.0$/, ""));
const hoursRange = (a: number, b: number) => `${(a / 60).toFixed(0)} to ${(b / 60).toFixed(0)} h`;

/**
 * Compare one day's totals (or a per-day average) with the ranges for that age.
 * `complete` is false for today, which is still being written: nothing is
 * flagged short until the day is over. From 12 months nothing is judged at all:
 * feeds and diapers are a plain count with no usual number, sleep shows its usual
 * range, and a kind that `logged` says was not logged has no row. `logged` is not
 * read for a baby, whose rows are always all there.
 */
export function checkDay(t: DayTotals, days: number, complete: boolean, logged: LoggedKinds): CheckRow[] {
  const norms = normsForAge(days);
  if (isToddler(days)) return toddlerRows(t, norms, complete, logged);
  const judge = (v: number, norm: Norm): Verdict => {
    if (!complete) return "so_far";
    if (v < norm.low) return norm.flagLow ? "short" : "ok";
    if (v > norm.high) return "more";
    return "ok";
  };
  const feedNorm = norms.feeds!;
  const mlNorm = norms.bottleMl!;
  const wetNorm = norms.wet!;
  const dirtyNorm = norms.dirty!;
  const rows: CheckRow[] = [];
  const feeds = t.breast_count + t.bottle_count;
  rows.push({ key: "feeds", label: "Feeds", value: count(feeds), typical: `${feedNorm.low} to ${feedNorm.high}`, verdict: judge(feeds, feedNorm), note: feedNorm.note });
  if (t.bottle_count > 0 && t.breast_count === 0) {
    rows.push({ key: "ml", label: "Milk by bottle", value: `${Math.round(t.bottle_ml)} ml`, typical: `${mlNorm.low} to ${mlNorm.high} ml`, verdict: judge(t.bottle_ml, mlNorm) });
  } else if (t.bottle_ml > 0) {
    rows.push({ key: "ml", label: "Milk by bottle", value: `${Math.round(t.bottle_ml)} ml`, typical: "", note: "No usual amount alongside breastfeeds", verdict: complete ? "ok" : "so_far" });
  }
  rows.push({ key: "wet", label: "Wet diapers", value: count(t.diapers_wet), typical: `${wetNorm.low} to ${wetNorm.high}`, verdict: judge(t.diapers_wet, wetNorm) });
  rows.push({ key: "dirty", label: "Dirty diapers", value: count(t.diapers_dirty), typical: `${dirtyNorm.low} to ${dirtyNorm.high}`, verdict: judge(t.diapers_dirty, dirtyNorm), note: dirtyNorm.note });
  rows.push({ key: "sleep", label: "Sleep in 24 h", value: hours(t.sleep_min), typical: hoursRange(norms.sleepMin.low, norms.sleepMin.high), verdict: judge(t.sleep_min, norms.sleepMin) });
  rows.push({ key: "night", label: "Night sleep", value: hours(t.night_sleep_min), typical: hoursRange(norms.nightSleepMin.low, norms.nightSleepMin.high), verdict: judge(t.night_sleep_min, norms.nightSleepMin), note: norms.nightSleepMin.note });
  return rows;
}

/** A toddler's rows: what was logged, never a verdict. */
function toddlerRows(t: DayTotals, norms: AgeNorms, complete: boolean, logged: LoggedKinds): CheckRow[] {
  const verdict: Verdict = complete ? "ok" : "so_far";
  const rows: CheckRow[] = [];
  if (logged.feed) {
    rows.push({ key: "feeds", label: "Feeds", value: count(t.breast_count + t.bottle_count), typical: "", verdict, note: NO_USUAL });
    if (t.bottle_ml > 0) rows.push({ key: "ml", label: "Milk by bottle", value: `${Math.round(t.bottle_ml)} ml`, typical: "", verdict, note: NO_USUAL });
  }
  if (logged.diaper) {
    rows.push({ key: "wet", label: "Wet diapers", value: count(t.diapers_wet), typical: "", verdict, note: NO_USUAL });
    rows.push({ key: "dirty", label: "Dirty diapers", value: count(t.diapers_dirty), typical: "", verdict, note: NO_USUAL });
  }
  if (logged.sleep) {
    rows.push({ key: "sleep", label: "Sleep in 24 h", value: hours(t.sleep_min), typical: hoursRange(norms.sleepMin.low, norms.sleepMin.high), verdict });
    rows.push({ key: "night", label: "Night sleep", value: hours(t.night_sleep_min), typical: hoursRange(norms.nightSleepMin.low, norms.nightSleepMin.high), verdict });
  }
  return rows;
}

// ---- a day's average over the days that were logged (X8) ----------------------------------------

/** Each daily number the averages know, and the kind of entry it comes from. */
const KIND_OF = {
  breast_count: "feed",
  breast_min: "feed",
  left_count: "feed",
  right_count: "feed",
  bottle_count: "feed",
  bottle_ml: "feed",
  night_feeds: "feed",
  diapers: "diaper",
  diapers_wet: "diaper",
  diapers_dirty: "diaper",
  sleep_min: "sleep",
  nap_count: "sleep",
  night_sleep_min: "sleep",
  longest_stretch_min: "sleep",
  night_wakes: "sleep",
} as const satisfies Record<string, LogKind>;
export type AverageKey = keyof typeof KIND_OF;

/** One row of care_daily_stats, as much of it as the averages read. */
export type AverageDay = { day: string; breast_count: number; bottle_count: number; diapers: number; sleep_min: number; night_sleep_min: number } & Partial<Record<AverageKey, number>>;

export interface DayAverages {
  /** The seven numbers "against her age" compares, each a day's average over the days its kind counted. */
  totals: DayTotals;
  /** Any daily number, the same way. */
  mean: (key: AverageKey) => number;
  /** Days each kind counted. */
  counted: Record<LogKind, number>;
  /** Which kinds have a counted day (checkDay's `logged`). */
  logged: LoggedKinds;
  /** Days in the period. */
  days: number;
  /** Days on which at least one kind counted. */
  loggedDays: number;
  /** Every kind that was logged at all counted on every day: the screens' own subtitle stays. */
  everyDay: boolean;
}

/**
 * A day's average over the days that were logged, chosen by the kind of entry, never by the
 * number: the feed numbers average over days with any feed, the diaper numbers over days
 * with any diaper, the sleep numbers over days with any sleep. A zero inside a counted day
 * stays a zero, so with every day logged the numbers are the plain mean. A day before the
 * family began logging no longer reads as a day of nothing.
 *
 * For a toddler (`toddler`) a day counts for sleep only when it is whole: it and the day
 * before both have night sleep, so a family's first evening is not a 4-hour day. The day
 * before the first of `days` is `dayBefore` (null when it was not fetched: the first day
 * then never counts for a toddler's sleep). `days` are the period, oldest first.
 */
export function dayAverages(days: readonly AverageDay[], dayBefore: AverageDay | null, toddler: boolean): DayAverages {
  const byDay = new Map<string, AverageDay>();
  for (const d of dayBefore ? [dayBefore, ...days] : days) byDay.set(d.day, d);
  const previous = (day: string) => byDay.get(new Date(Date.parse(day) - 86_400_000).toISOString().slice(0, 10)) ?? null;
  const has: Record<LogKind, (d: AverageDay) => boolean> = {
    feed: (d) => Number(d.breast_count) + Number(d.bottle_count) > 0,
    diaper: (d) => Number(d.diapers) > 0,
    sleep: (d) => (toddler ? Number(d.night_sleep_min) > 0 && Number(previous(d.day)?.night_sleep_min ?? 0) > 0 : Number(d.sleep_min) + Number(d.night_sleep_min) > 0),
  };
  const counts = (kind: LogKind) => days.filter(has[kind]);
  const sets: Record<LogKind, AverageDay[]> = { feed: counts("feed"), diaper: counts("diaper"), sleep: counts("sleep") };
  const mean = (key: AverageKey) => {
    const over = sets[KIND_OF[key]];
    return over.length ? over.reduce((a, d) => a + (Number(d[key]) || 0), 0) / over.length : 0;
  };
  const counted = { feed: sets.feed.length, diaper: sets.diaper.length, sleep: sets.sleep.length };
  const loggedDays = days.filter((d) => has.feed(d) || has.diaper(d) || has.sleep(d)).length;
  return {
    totals: { breast_count: mean("breast_count"), bottle_count: mean("bottle_count"), bottle_ml: mean("bottle_ml"), diapers_wet: mean("diapers_wet"), diapers_dirty: mean("diapers_dirty"), sleep_min: mean("sleep_min"), night_sleep_min: mean("night_sleep_min") },
    mean,
    counted,
    logged: { feed: counted.feed > 0, diaper: counted.diaper > 0, sleep: counted.sleep > 0 },
    days: days.length,
    loggedDays,
    everyDay: (Object.values(counted) as number[]).every((n) => n === 0 || n === days.length),
  };
}

/**
 * The subtitle when not every day counted, for a `period` such as "this week": "A day's
 * average over the 4 days logged this week."; null when every day counted and the screen's
 * own subtitle stays.
 */
export function averagesLine(a: DayAverages, period: string): string | null {
  if (a.everyDay) return null;
  return `A day's average over the ${a.loggedDays === 1 ? "1 day" : `${a.loggedDays} days`} logged ${period}.`;
}
