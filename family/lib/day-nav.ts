import { addDays } from "./time.ts";

/**
 * The one day a section shows (Feeds, Sleep; DESIGN.md, "The Sleep and Feeds sections"):
 * today, or one of the days before it that the section has entries for, named by `?day=`.
 * Anything else in the address (a day out of range, a word, two values) is today. `prev` and
 * `next` are the days the pager's arrows and a swipe go to, null at either end.
 */
export interface DayNav {
  day: string;
  isToday: boolean;
  prev: string | null;
  next: string | null;
}

export function dayNav(param: string | string[] | undefined, today: string, daysBack = 6): DayNav {
  const asked = Array.isArray(param) ? param[0] : param;
  const first = addDays(today, -daysBack);
  // A real calendar day, written as the address writes it (addDays round-trips only those).
  const real = !!asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) && addDays(asked, 0) === asked;
  const day = real && asked! >= first && asked! <= today ? asked! : today;
  return { day, isToday: day === today, prev: day > first ? addDays(day, -1) : null, next: day < today ? addDays(day, 1) : null };
}

/** The address of a section on a day: today has none of its own. */
export function dayHref(base: string, day: string | null, today: string): string | null {
  return day == null ? null : day === today ? base : `${base}?day=${day}`;
}
