/**
 * WHO Child Growth Standards (2006), girls, birth to 24 months: the 3rd, 50th
 * and 97th percentiles for weight, length and head circumference. Weight is
 * monthly; length and head are at three-month points and interpolated. The
 * values are the published simplified field tables rounded to one decimal;
 * the doctor's chart is the reference and this is the picture beside it.
 */

export type GrowthKind = "weight_kg" | "length_cm" | "head_cm";

interface Curve {
  months: number[];
  p3: number[];
  p50: number[];
  p97: number[];
}

const M24 = Array.from({ length: 25 }, (_, i) => i);
const Q24 = [0, 3, 6, 9, 12, 15, 18, 21, 24];

export const GIRLS: Record<GrowthKind, Curve> = {
  weight_kg: {
    months: M24,
    p3: [2.4, 3.2, 4.0, 4.6, 5.1, 5.5, 5.8, 6.1, 6.3, 6.6, 6.8, 7.0, 7.1, 7.3, 7.5, 7.7, 7.8, 8.0, 8.2, 8.3, 8.5, 8.7, 8.8, 9.0, 9.2],
    p50: [3.2, 4.2, 5.1, 5.8, 6.4, 6.9, 7.3, 7.6, 7.9, 8.2, 8.5, 8.7, 8.9, 9.2, 9.4, 9.6, 9.8, 10.0, 10.2, 10.4, 10.6, 10.9, 11.1, 11.3, 11.5],
    p97: [4.2, 5.4, 6.5, 7.4, 8.1, 8.7, 9.2, 9.6, 10.0, 10.4, 10.7, 11.0, 11.3, 11.6, 11.9, 12.2, 12.5, 12.7, 13.0, 13.3, 13.5, 13.8, 14.1, 14.3, 14.6],
  },
  length_cm: {
    months: Q24,
    p3: [45.6, 55.8, 61.5, 65.6, 69.2, 72.4, 75.2, 77.8, 80.3],
    p50: [49.1, 59.8, 65.7, 70.1, 74.0, 77.5, 80.7, 83.7, 86.4],
    p97: [52.7, 63.8, 70.0, 74.7, 78.9, 82.6, 86.1, 89.5, 92.5],
  },
  head_cm: {
    months: Q24,
    p3: [31.7, 37.1, 39.7, 41.2, 42.3, 43.0, 43.5, 44.0, 44.4],
    p50: [33.9, 39.5, 42.2, 43.8, 44.9, 45.6, 46.2, 46.7, 47.2],
    p97: [36.1, 41.9, 44.6, 46.3, 47.5, 48.3, 48.9, 49.4, 49.9],
  },
};

export const MONTH_DAYS = 30.4375;

function at(months: number[], values: number[], m: number): number {
  if (m <= months[0]) return values[0];
  if (m >= months[months.length - 1]) return values[values.length - 1];
  let i = 1;
  while (months[i] < m) i++;
  const f = (m - months[i - 1]) / (months[i] - months[i - 1]);
  return values[i - 1] + f * (values[i] - values[i - 1]);
}

/** The three reference values at an age in days. Null past 24 months. */
export function reference(kind: GrowthKind, ageDays: number): { p3: number; p50: number; p97: number } | null {
  const m = ageDays / MONTH_DAYS;
  if (m < 0 || m > 24.5) return null;
  const c = GIRLS[kind];
  return { p3: at(c.months, c.p3, m), p50: at(c.months, c.p50, m), p97: at(c.months, c.p97, m) };
}

/** Standard normal CDF, good to about 1e-3. */
function cdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z >= 0 ? 1 - p : p;
}

/**
 * Roughly which percentile a measurement sits on, treating the gap from the
 * median to the 3rd or 97th percentile as 1.88 standard deviations. Good
 * enough to say "about the 40th"; the doctor's chart gives the exact one.
 */
export function percentileOf(kind: GrowthKind, ageDays: number, value: number): number | null {
  const r = reference(kind, ageDays);
  if (!r || !(value > 0)) return null;
  const z = value <= r.p50 ? (-1.88 * (r.p50 - value)) / (r.p50 - r.p3) : (1.88 * (value - r.p50)) / (r.p97 - r.p50);
  return Math.round(Math.min(99, Math.max(1, cdf(z) * 100)));
}

export function percentileLabel(p: number): string {
  if (p < 3) return "below the 3rd percentile";
  if (p > 97) return "above the 97th percentile";
  return `about the ${p}${p % 10 === 1 && p !== 11 ? "st" : p % 10 === 2 && p !== 12 ? "nd" : p % 10 === 3 && p !== 13 ? "rd" : "th"} percentile`;
}
