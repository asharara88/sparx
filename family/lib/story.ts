/**
 * The monthly story: month 1 runs from birth to the day before her first
 * monthly birthday, and so on. The monthly birthday is the same day of the
 * month as her birth, or the last day of a shorter month.
 */

export function addMonths(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const daysIn = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, daysIn))).toISOString().slice(0, 10);
}

export function addDaysYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export interface StoryMonth {
  month: number;
  /** First day of the month, inclusive. */
  from: string;
  /** Last day of the month, inclusive. */
  to: string;
  /** The monthly birthday that closes it. */
  birthday: string;
  /** Still running on `today`. */
  inProgress: boolean;
}

/** The month's span. Null for month 0 or earlier. */
export function storyMonth(birthDate: string, month: number, today: string): StoryMonth | null {
  if (month < 1) return null;
  const from = addMonths(birthDate, month - 1);
  const birthday = addMonths(birthDate, month);
  const to = addDaysYmd(birthday, -1);
  if (from > today) return null;
  return { month, from, to: to < today ? to : today, birthday, inProgress: birthday > today };
}

/** Which month she is in on `today`: 1 during the first month. */
export function currentMonth(birthDate: string, today: string): number {
  let m = 1;
  while (addMonths(birthDate, m) <= today) m++;
  return m;
}

/** The month whose birthday is `today`, or null. */
export function birthdayMonth(birthDate: string, today: string): number | null {
  const m = currentMonth(birthDate, today) - 1;
  return m >= 1 && addMonths(birthDate, m) === today ? m : null;
}
