/**
 * Work hours as hhmm numbers in household time. Each member's hours live on their row
 * (Members → Work days); these are the fallback when none are set: a 8:30 to 17:30 working day.
 */
export const WORK_FROM = 830;
export const WORK_TO = 1730;
/** "08:30:00" → 830 */
export function hhmm(t: string | null | undefined, fallback: number): number {
  if (!t) return fallback;
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  return m ? Number(m[1]) * 100 + Number(m[2]) : fallback;
}
