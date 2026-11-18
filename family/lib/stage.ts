/**
 * The child's stage, from their age in days: what is usual now for awake time,
 * naps, the gap between milk feeds and meals. One table, so Home, the dashboard,
 * the guide and the helper all expect the same thing. Common paediatric guidance
 * (NHS, AAP); estimates, labelled as such on screen. Pure: no "@/" imports, so the
 * unit tests load it on its own.
 *
 * From 12 months (day 366; day 365 is still a baby) the child is a toddler: no milk
 * clock, no usual number of feeds or diapers, longer sleeps and bigger bottles before
 * an entry is questioned. Everything for a baby stays as it was.
 */

export type Band = "0-3" | "3-6" | "6-9" | "9-12" | "12-18" | "18-24" | "24-36" | "36+";

/** Where a logged value stops looking real and is asked about, and how long "awake for" is believed. */
export interface Limits {
  /** A sleep longer than this, in minutes, is questioned (entry checks). */
  longSleepMin: number;
  /** A bottle over this, in ml, is questioned (entry checks). */
  bigBottleMl: number;
  /** Home's top card says "Awake for" up to this many minutes since the last sleep, then nothing. */
  awakeKnownMin: number;
}

export interface Stage {
  band: Band;
  /** "6 to 9 months", for the helper and the screens. */
  label: string;
  /** Usual awake window, minutes (a toddler's from the age alone; awakeWindow takes the nap pattern too). */
  awake: [number, number];
  /** Usual number of naps a day. */
  naps: [number, number];
  /** Usual gap between milk feeds at its longest (a full feed), minutes. */
  feedEveryMin: number;
  /** Usual meals a day, or null before solids. */
  meals: [number, number] | null;
  /** Meals can be logged: from 24 weeks, so a family starting a little early is not locked out. */
  solids: boolean;
  /** 12 months or older (isToddler). */
  toddler: boolean;
  /** Milk feeds have a next-due time: a baby only. A toddler's milk has no clock anywhere. */
  milkClock: boolean;
  limits: Limits;
}

const MONTH = 30.4375;
export const SOLIDS_FROM_DAYS = 168;

/**
 * A toddler: 12 months or older, counted as the database counts it (day 366 on; day 365
 * is a baby). A child with no birth date is a baby, as the app has always assumed.
 */
export function isToddler(ageDays: number | null | undefined): boolean {
  return ageDays != null && ageDays / MONTH >= 12;
}

const LIMITS: { baby: Limits; toddler: Limits } = {
  baby: { longSleepMin: 600, bigBottleMl: 240, awakeKnownMin: 720 },
  // A child with no nap is awake 12 to 13 hours, so "Awake for" holds to 16.
  toddler: { longSleepMin: 780, bigBottleMl: 350, awakeKnownMin: 960 },
};

/** The limits for an age in days; a baby's when no birth date is known. */
export function limitsFor(ageDays: number | null): Limits {
  return isToddler(ageDays) ? LIMITS.toddler : LIMITS.baby;
}

/** Naps a day with nothing in the log to go by: two before 15 months, one from 15 months. */
export function defaultNaps(ageDays: number): number {
  return ageDays / MONTH < 15 ? 2 : 1;
}

/**
 * Typical awake window in minutes by age; under 6 months exactly as the app has always
 * used. From 12 months to 17 months it depends on the day: two naps (`napsPerDay` 2) or one
 * (1, or 0 for a child who has stopped); null means nothing in the log to go by (two naps
 * before 15 months, one from 15). `napsPerDay` is not read for a baby.
 */
export function awakeWindow(ageDays: number, napsPerDay: number | null): [number, number] {
  if (ageDays < 42) return [45, 60];
  if (ageDays < 84) return [60, 90];
  if (ageDays < 120) return [75, 120];
  if (ageDays < 180) return [105, 150];
  const m = ageDays / MONTH;
  if (m < 9) return [120, 180];
  if (m < 12) return [150, 210];
  if (m < 18) return (napsPerDay ?? defaultNaps(ageDays)) >= 2 ? [180, 240] : [270, 360];
  if (m < 24) return [300, 360];
  if (m < 36) return [300, 390];
  return [360, 420];
}

export function stageOf(ageDays: number): Stage {
  const m = Math.max(0, ageDays) / MONTH;
  const awake = awakeWindow(ageDays, null);
  const solids = ageDays >= SOLIDS_FROM_DAYS;
  const toddler = isToddler(ageDays);
  const s = (band: Band, label: string, naps: [number, number], feedEveryMin: number, meals: [number, number] | null): Stage => ({ band, label, awake, naps, feedEveryMin, meals, solids, toddler, milkClock: !toddler, limits: limitsFor(ageDays) });
  if (m < 3) return s("0-3", "0 to 3 months", [4, 5], 180, null);
  if (m < 6) return s("3-6", "3 to 6 months", [3, 4], 180, solids ? [1, 1] : null);
  if (m < 9) return s("6-9", "6 to 9 months", [2, 3], 240, [1, 2]);
  if (m < 12) return s("9-12", "9 to 12 months", [2, 2], 240, [2, 3]);
  if (m < 18) return s("12-18", "12 to 18 months", [1, 2], 300, [3, 3]);
  if (m < 24) return s("18-24", "18 to 24 months", [1, 1], 300, [3, 3]);
  if (m < 36) return s("24-36", "2 to 3 years", [0, 1], 300, [3, 3]);
  return s("36+", "3 years and over", [0, 1], 300, [3, 3]);
}

/**
 * Age in whole days at an instant (birth date as YYYY-MM-DD), counted on the home's
 * calendar: it goes up at local midnight. Counted from the instant instead, it went up at
 * 04:00 in the Gulf (UTC midnight), so a stage (solids, the feed gap) changed 4 h late.
 */
export function ageInDays(birthDate: string | null | undefined, now = Date.now(), tz = "UTC"): number | null {
  if (!birthDate) return null;
  const b = Date.parse(birthDate.slice(0, 10));
  if (!Number.isFinite(b)) return null;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return Math.round((Date.parse(today) - b) / 86_400_000);
}

/** The stage for a child, or the newborn-ish default (120 days) the app has always assumed when no birth date is known. */
export function stageFor(birthDate: string | null | undefined, now = Date.now(), tz = "UTC"): Stage {
  return stageOf(ageInDays(birthDate, now, tz) ?? 120);
}

/** "2–3", "2". */
export const range = ([a, b]: [number, number]) => (a === b ? `${a}` : `${a}–${b}`);

/** When "last feed" turns yellow and red, minutes: an hour and two past the usual longest gap (4 h and 5 h under 6 months). */
export function feedLateMin(s: Stage): [number, number] {
  return [s.feedEveryMin + 60, s.feedEveryMin + 120];
}

/** The base gap for "next feed due": the type's own (180 by default) or the stage's, whichever is longer. */
export function feedGapFor(s: Stage, typeGapMin: number | null | undefined): number {
  return Math.max(typeGapMin ?? 180, s.feedEveryMin);
}

/**
 * Pumping goes on: a pump logged in the last 14 days, or, for a baby, none ever (a new
 * parent still sees the Pump row). A toddler's home with no pump in 14 days has no pumping.
 */
export function pumpingActive(lastPumpAt: string | null | undefined, now: number, ageDays: number | null): boolean {
  if (!lastPumpAt) return !isToddler(ageDays);
  return now - Date.parse(lastPumpAt) <= 14 * 86_400_000;
}

/**
 * The nap count on Sleep today: "2 of 2–3 naps" while within what is usual, "4 naps" past
 * it, "no nap yet, usually 2–3". When the usual range starts at 0 (from 2 years) a plain
 * count: "1 nap", "2 naps", "no nap"; a child who has stopped napping is not "yet" to nap.
 */
export function napsLine(n: number, usual: [number, number] | null, isToday: boolean): string {
  const plain = `${n} nap${n === 1 ? "" : "s"}`;
  if (usual && usual[0] === 0 && usual[1] > 0) return n ? plain : "no nap";
  if (!usual || usual[1] === 0) return n ? plain : isToday ? "no nap yet" : "no nap";
  if (!n) return isToday ? (usual[0] ? `no nap yet, usually ${range(usual)}` : "no nap yet") : "no nap";
  if (n > usual[1] || !isToday) return plain;
  return `${n} of ${range(usual)} naps`;
}
