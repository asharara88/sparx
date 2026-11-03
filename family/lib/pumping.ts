/**
 * The pumping numbers: today against the goal, and the usual day from the
 * last week's daily stats. Pure, so it is unit-tested.
 */
export interface PumpDay {
  day: string;
  pump_ml: number;
}

export interface PumpSummary {
  /** The last seven full days (yesterday back), oldest first, ml each. */
  week: { day: string; ml: number }[];
  /** Average ml on the days of that week that had a pump; 0 when none. */
  averageMl: number;
  /** How many of those days had a pump. */
  pumpingDays: number;
  /** The biggest day of the week and today, for the bars' scale. */
  maxMl: number;
}

export function pumpSummary(days: PumpDay[], today: string, todayMl: number): PumpSummary {
  const full = days.filter((d) => d.day < today).sort((a, b) => (a.day < b.day ? -1 : 1)).slice(-7);
  const week = full.map((d) => ({ day: d.day, ml: Math.max(0, Math.round(d.pump_ml || 0)) }));
  const pumping = week.filter((d) => d.ml > 0);
  const averageMl = pumping.length ? Math.round(pumping.reduce((n, d) => n + d.ml, 0) / pumping.length) : 0;
  return { week, averageMl, pumpingDays: pumping.length, maxMl: Math.max(1, todayMl, ...week.map((d) => d.ml)) };
}

/** "on track", "ahead", "behind": today so far against the usual day, in words. */
export function todayVersusUsual(todayMl: number, averageMl: number, hourOfDay: number): string {
  if (!averageMl) return todayMl ? "No usual day yet." : "Nothing pumped this week yet.";
  if (todayMl >= averageMl) return `Already past a usual day (${averageMl} ml).`;
  // Before the evening the day is not over: compare with where a usual day would be by now.
  const share = Math.min(1, Math.max(0.15, hourOfDay / 22));
  const expected = Math.round(averageMl * share);
  if (todayMl >= expected) return `On track for a usual day (${averageMl} ml).`;
  return `${averageMl - todayMl} ml short of a usual day (${averageMl} ml).`;
}
