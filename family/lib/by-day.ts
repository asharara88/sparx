/**
 * Entries grouped by the household's calendar day, newest day first and newest entry first
 * within it: the Sleep and Feed sections list "every sleep" and "every feed" this way.
 * Pure: the caller passes how to name a day, so the unit tests load it on its own.
 */
export function byDay<T extends { occurred_at: string }>(entries: T[], dayOf: (iso: string) => string): { day: string; entries: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const e of [...entries].sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))) {
    const d = dayOf(e.occurred_at);
    groups.set(d, [...(groups.get(d) ?? []), e]);
  }
  return [...groups.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([day, list]) => ({ day, entries: list }));
}

/** "Today", "Yesterday", or the weekday ("Tuesday") for a YYYY-MM-DD within the week. */
export function dayLabel(day: string, today: string): string {
  if (day === today) return "Today";
  const t = Date.parse(`${today}T12:00:00Z`);
  const d = Date.parse(`${day}T12:00:00Z`);
  const back = Math.round((t - d) / 86_400_000);
  if (back === 1) return "Yesterday";
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date(d).getUTCDay()];
}
