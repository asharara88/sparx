import type { EntryRow, MilkBottle } from "@/lib/types";

/**
 * Milk sense: when the fridge runs out at the current pace, how the pumping is
 * going, and which freezer bags to bring down tonight for tomorrow's bottles.
 * Pure functions over the stash and the log; nothing here writes.
 */

const D = 86_400_000;
const t = (iso: string) => Date.parse(iso);
const median = (xs: number[]) => {
  const v = [...xs].sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : 0;
};
const isBottle = (e: EntryRow) => e.type_id === "lana.feed" && e.payload.method === "Bottle";
const ml = (e: EntryRow) => Number(e.payload.amount_ml) || 0;

/** Her usual bottle: the median of the last week, 120 ml with fewer than three. */
export function usualBottle(entries: EntryRow[]): number {
  const mls = entries.filter(isBottle).map(ml).filter((n) => n > 20);
  return mls.length >= 3 ? median(mls) : 120;
}

export interface MilkForecast {
  /** ml of bottles a day, last 7 days. */
  usePerDay: number;
  /** ml pumped a day, last 7 days. */
  pumpPerDay: number;
  /** Net drain on the fridge per day (use minus pump); 0 or less means pumping keeps up. */
  netPerDay: number;
  /** Epoch ms when safe fridge milk runs out at this pace; null when it does not. */
  until: number | null;
  /** How much more to pump a day to keep up. */
  shortPerDay: number;
}

export function milkForecast(safeFridgeMl: number, entries: EntryRow[], now = Date.now()): MilkForecast {
  const week = entries.filter((e) => t(e.occurred_at) > now - 7 * D);
  const usePerDay = week.filter(isBottle).reduce((s, e) => s + ml(e), 0) / 7;
  const pumpPerDay = week.filter((e) => e.type_id === "lana.pump").reduce((s, e) => s + ml(e), 0) / 7;
  const net = usePerDay - pumpPerDay;
  if (usePerDay < 1) return { usePerDay: 0, pumpPerDay: Math.round(pumpPerDay), netPerDay: Math.round(net), until: null, shortPerDay: 0 };
  return {
    usePerDay: Math.round(usePerDay),
    pumpPerDay: Math.round(pumpPerDay),
    netPerDay: Math.round(net),
    until: net <= 0 ? null : now + (safeFridgeMl / net) * D,
    shortPerDay: Math.max(0, Math.round(net)),
  };
}

export interface PumpInsights {
  morning: number | null;
  night: number | null;
  lastDay: number;
  prevDay: number;
  /** Fraction change week on week; null without a previous week. */
  change: number | null;
  dropping: boolean;
  count: number;
}

/** Morning (before 14:00) versus night pump averages and the week-on-week trend. */
export function pumpInsights(entries: EntryRow[], timezone: string, now = Date.now()): PumpInsights {
  const pumps = entries.filter((e) => e.type_id === "lana.pump" && ml(e) > 0);
  const last = pumps.filter((e) => t(e.occurred_at) > now - 7 * D);
  const prev = pumps.filter((e) => t(e.occurred_at) <= now - 7 * D && t(e.occurred_at) > now - 14 * D);
  const hour = (e: EntryRow) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "numeric", hourCycle: "h23" }).format(new Date(e.occurred_at)));
  const avg = (xs: EntryRow[]) => (xs.length ? Math.round(xs.reduce((s, e) => s + ml(e), 0) / xs.length) : null);
  const sum = (xs: EntryRow[]) => xs.reduce((s, e) => s + ml(e), 0);
  const lastDay = Math.round(sum(last) / 7);
  const prevDay = Math.round(sum(prev) / 7);
  const change = prevDay > 0 ? (lastDay - prevDay) / prevDay : null;
  return {
    morning: avg(last.filter((e) => hour(e) < 14)),
    night: avg(last.filter((e) => hour(e) >= 14)),
    lastDay,
    prevDay,
    change,
    dropping: change !== null && change < -0.15,
    count: last.length,
  };
}

export interface ThawPlan {
  /** ml tomorrow's bottles will need while Mama is away. */
  need: number;
  /** ml safe in the fridge now. */
  have: number;
  /** Freezer bags to bring down, oldest first. Empty when the fridge covers it. */
  picks: MilkBottle[];
  /** ml still missing after every bag. */
  short: number;
}

/**
 * The evening before a workday: how many bottles tomorrow needs (one per
 * interval across the away window), what the fridge holds, and which freezer
 * bags to move down. Returns null when it is not evening or Mama is not away tomorrow.
 */
export function thawPlan(bottles: MilkBottle[], entries: EntryRow[], opts: { awayTomorrow: boolean; awayMinutes: number; intervalMin: number; hour: number }): ThawPlan | null {
  if (opts.hour < 17 || !opts.awayTomorrow || opts.awayMinutes <= 0) return null;
  const size = usualBottle(entries);
  const need = Math.max(1, Math.ceil(opts.awayMinutes / Math.max(60, opts.intervalMin))) * size;
  const have = bottles.filter((b) => b.location === "fridge" && !b.expired).reduce((s, b) => s + b.amount_ml, 0);
  if (have >= need) return { need, have, picks: [], short: 0 };
  const picks: MilkBottle[] = [];
  let got = have;
  for (const b of bottles.filter((x) => x.location === "freezer" && !x.expired && x.amount_ml > 0).sort((a, b) => t(a.pumped_at) - t(b.pumped_at))) {
    if (got >= need) break;
    picks.push(b);
    got += b.amount_ml;
  }
  return { need, have, picks, short: Math.max(0, need - got) };
}
