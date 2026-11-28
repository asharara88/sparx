/**
 * Effort, counted (DESIGN.md, "Effort, counted"; migration 7050): plain totals of the care
 * that was saved since the child was born. A person sees their own and the whole home's,
 * never another member's, so no screen sets one person's numbers beside another's. Nothing
 * here is a goal: there is no target, no bar, no "this month against last". The numbers only
 * ever grow.
 *
 * Pure: no "@/" imports, so the unit tests run it as it is.
 */
import { addDaysYmd, birthdayMonth } from "./story.ts";

/** One sum, as effort_totals() returns it (the caller's own, or the home's). */
export interface EffortSum {
  days: number;
  first_day: string | null;
  feeds: number;
  breast_min: number;
  pumps: number;
  pump_ml: number;
  diapers: number;
  sleeps: number;
  meals: number;
}
export interface EffortRow {
  label: string;
  value: string;
}

const whole = (x: number) => new Intl.NumberFormat("en-GB").format(Math.round(x));
/** Litres with one decimal under ten, whole from ten: "4.6", "61". */
const litres = (ml: number) => (ml < 10_000 ? (Math.round(ml / 100) / 10).toFixed(1).replace(/\.0$/, "") : whole(ml / 1000));

/**
 * The rows of one sum, one number each (DESIGN.md, rule 4), in a fixed order. A kind with
 * nothing saved is left out, never shown as a zero: a home that does not pump is not told
 * "0 litres", and a father is not shown "0 hours at the breast". Hours and litres appear
 * once there is a whole hour and a tenth of a litre to show.
 *
 * "Days of care" is the home's row only. Every other row is an open count; days have a
 * ceiling (the child's age), so on one person's list "9" would read as nine out of a hundred
 * and fifty, a score. On the home's list it is simply how long this has been going on.
 */
export function effortRows(s: EffortSum, whose: "you" | "all"): EffortRow[] {
  const rows: EffortRow[] = [];
  if (whose === "all" && s.days > 0) rows.push({ label: "Days of care", value: whole(s.days) });
  if (s.feeds > 0) rows.push({ label: "Feeds", value: whole(s.feeds) });
  if (s.breast_min >= 60) rows.push({ label: "Hours at the breast", value: whole(Math.floor(s.breast_min / 60)) });
  if (s.pump_ml >= 100) rows.push({ label: "Litres pumped", value: litres(s.pump_ml) });
  if (s.diapers > 0) rows.push({ label: "Diapers", value: whole(s.diapers) });
  if (s.sleeps > 0) rows.push({ label: "Times settled to sleep", value: whole(s.sleeps) });
  if (s.meals > 0) rows.push({ label: "Meals", value: whole(s.meals) });
  return rows;
}

/**
 * The child's age in months when today is a monthly birthday or one of the two days after
 * it, else null: Home's line shows for those three days, so a parent who did not open the
 * app on the day itself still meets it.
 */
export function effortMonth(birthDate: string | null | undefined, today: string): number | null {
  if (!birthDate) return null;
  for (let back = 0; back < 3; back++) {
    const m = birthdayMonth(birthDate, addDaysYmd(today, -back));
    if (m != null) return m;
  }
  return null;
}

/** Home's line on those days: "5 months with Mia, counted", "A year with Mia, counted". */
export function effortLine(months: number, name: string): string {
  const span = months === 1 ? "A month" : months === 12 ? "A year" : months % 12 === 0 ? `${months / 12} years` : `${months} months`;
  return `${span} with ${name}, counted`;
}
