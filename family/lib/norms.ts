/**
 * Typical daily ranges for a healthy term baby, by age. General guidance from
 * the NHS, the American Academy of Pediatrics and the National Sleep
 * Foundation, rounded to whole numbers. They are for a quick glance, not a
 * diagnosis: a day that looks short is just as often a day that was not fully
 * written down.
 */
export interface Norm {
  low: number;
  high: number;
  /** When true a value under `low` is worth a flag; otherwise it is only shown. */
  flagLow: boolean;
  note?: string;
}
export interface AgeNorms {
  feeds: Norm;
  /** Only when the day was bottles only (ml per day). */
  bottleMl: Norm;
  wet: Norm;
  dirty: Norm;
  sleepMin: Norm;
  nightSleepMin: Norm;
}

export function ageDays(birthDate: string, day: string): number {
  return Math.floor((Date.parse(day) - Date.parse(birthDate)) / 86_400_000);
}

export function ageLabel(days: number): string {
  if (days < 0) return "not born yet";
  if (days < 14) return `${days} day${days === 1 ? "" : "s"}`;
  const weeks = Math.floor(days / 7);
  if (days < 7 * 16) return `${weeks} weeks`;
  const months = Math.floor(days / 30.4375);
  return `${months} month${months === 1 ? "" : "s"}`;
}

export function normsForAge(days: number): AgeNorms {
  const months = days / 30.4375;
  const n = (low: number, high: number, flagLow = true, note?: string): Norm => ({ low, high, flagLow, note });
  if (months < 1) {
    return {
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
      feeds: n(4, 6, true, "Plus solids."),
      bottleMl: n(600, 900),
      wet: n(5, 7),
      dirty: n(1, 2, false),
      sleepMin: n(12 * 60, 15 * 60),
      nightSleepMin: n(10 * 60, 12 * 60, false),
    };
  }
  return {
    feeds: n(3, 4, false, "Most food is solids now."),
    bottleMl: n(400, 600, false),
    wet: n(4, 6),
    dirty: n(1, 2, false),
    sleepMin: n(11 * 60, 14 * 60),
    nightSleepMin: n(10 * 60, 12 * 60, false),
  };
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

const hours = (min: number) => `${(min / 60).toFixed(min % 60 === 0 ? 0 : 1)} h`;
const hoursRange = (a: number, b: number) => `${(a / 60).toFixed(0)} to ${(b / 60).toFixed(0)} h`;

/**
 * Compare one day's totals (or a per-day average) with the ranges for that age.
 * `complete` is false for today, which is still being written: nothing is
 * flagged short until the day is over.
 */
export function checkDay(t: DayTotals, days: number, complete: boolean): CheckRow[] {
  const norms = normsForAge(days);
  const judge = (v: number, norm: Norm): Verdict => {
    if (!complete) return "so_far";
    if (v < norm.low) return norm.flagLow ? "short" : "ok";
    if (v > norm.high) return "more";
    return "ok";
  };
  const rows: CheckRow[] = [];
  const feeds = t.breast_count + t.bottle_count;
  rows.push({ key: "feeds", label: "Feeds", value: `${feeds}`, typical: `${norms.feeds.low} to ${norms.feeds.high}`, verdict: judge(feeds, norms.feeds), note: norms.feeds.note });
  if (t.bottle_count > 0 && t.breast_count === 0) {
    rows.push({ key: "ml", label: "Milk by bottle", value: `${Math.round(t.bottle_ml)} ml`, typical: `${norms.bottleMl.low} to ${norms.bottleMl.high} ml`, verdict: judge(t.bottle_ml, norms.bottleMl) });
  } else if (t.bottle_ml > 0) {
    rows.push({ key: "ml", label: "Milk by bottle", value: `${Math.round(t.bottle_ml)} ml`, typical: "No range with breastfeeds", verdict: complete ? "ok" : "so_far" });
  }
  rows.push({ key: "wet", label: "Wet diapers", value: `${t.diapers_wet}`, typical: `${norms.wet.low} to ${norms.wet.high}`, verdict: judge(t.diapers_wet, norms.wet) });
  rows.push({ key: "dirty", label: "Dirty diapers", value: `${t.diapers_dirty}`, typical: `${norms.dirty.low} to ${norms.dirty.high}`, verdict: judge(t.diapers_dirty, norms.dirty), note: norms.dirty.note });
  rows.push({ key: "sleep", label: "Sleep in 24 h", value: hours(t.sleep_min), typical: hoursRange(norms.sleepMin.low, norms.sleepMin.high), verdict: judge(t.sleep_min, norms.sleepMin) });
  rows.push({ key: "night", label: "Night sleep", value: hours(t.night_sleep_min), typical: hoursRange(norms.nightSleepMin.low, norms.nightSleepMin.high), verdict: judge(t.night_sleep_min, norms.nightSleepMin), note: norms.nightSleepMin.note });
  return rows;
}
