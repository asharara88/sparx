import type { EntryRow } from "@/lib/types";

/**
 * What her own log says about her rhythm: a possible growth spurt, and a sleep
 * coach (usual nap, the awake window before her best naps, usual bedtime).
 * Estimates, labelled as such on screen. Nothing here is medical advice.
 */

const D = 86_400_000;
const MIN = 60_000;
const t = (iso: string) => Date.parse(iso);
const median = (xs: number[]) => {
  const v = [...xs].sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : 0;
};

/** Typical awake window in minutes by age (common paediatric guidance). */
export function awakeWindow(ageDays: number): [number, number] {
  if (ageDays < 42) return [45, 60];
  if (ageDays < 84) return [60, 90];
  if (ageDays < 120) return [75, 120];
  if (ageDays < 180) return [105, 150];
  return [120, 180];
}

export interface GrowthSpurt {
  recentPerDay: number;
  beforePerDay: number;
}

/** Feeds a day up 25% or more over the last 2 full days against the 5 before. */
export function growthSpurt(entries: EntryRow[], dayOf: (ms: number) => string, now = Date.now()): GrowthSpurt | null {
  const today = dayOf(now);
  const per = new Map<string, number>();
  for (const e of entries) {
    if (e.type_id !== "lana.feed") continue;
    const k = dayOf(t(e.occurred_at));
    if (k !== today) per.set(k, (per.get(k) ?? 0) + 1);
  }
  const days = Array.from({ length: 7 }, (_, i) => dayOf(now - (i + 1) * D));
  const recent = days.slice(0, 2).map((k) => per.get(k) ?? 0);
  const before = days.slice(2).map((k) => per.get(k) ?? 0).filter((n) => n > 0);
  if (before.length < 3 || recent.some((n) => n === 0)) return null;
  const r = (recent[0] + recent[1]) / 2;
  const b = before.reduce((s, n) => s + n, 0) / before.length;
  if (b < 4 || r < b * 1.25) return null;
  return { recentPerDay: Math.round(r * 10) / 10, beforePerDay: Math.round(b * 10) / 10 };
}

export interface SleepCoach {
  napMin: number;
  /** Minutes awake before her longest naps. */
  bestWindowMin: number | null;
  /** "19:30" in the household clock, or null. */
  bedtime: string | null;
  naps: number;
  tip: string;
}

/** From 14 days of sleeps: usual nap length, the awake window before her best naps, usual bedtime, one tip. */
export function sleepCoach(entries: EntryRow[], ageDays: number, hourOf: (iso: string) => number): SleepCoach | null {
  const s = entries.filter((e) => e.type_id === "lana.sleep" && e.ended_at).sort((a, b) => t(a.occurred_at) - t(b.occurred_at));
  if (s.length < 6) return null;
  const len = (e: EntryRow) => (t(e.ended_at!) - t(e.occurred_at)) / MIN;
  const naps = s.filter((e) => {
    const h = hourOf(e.occurred_at);
    return h >= 7 && h < 18 && len(e) < 240;
  });
  const napMin = Math.round(median(naps.map(len)));
  const withWindow = naps
    .map((e) => {
      const prev = s[s.indexOf(e) - 1];
      return prev ? { len: len(e), before: (t(e.occurred_at) - t(prev.ended_at!)) / MIN } : null;
    })
    .filter((x): x is { len: number; before: number } => !!x && x.before > 15 && x.before < 300);
  const best = [...withWindow].sort((a, b) => b.len - a.len).slice(0, Math.max(2, Math.ceil(withWindow.length / 4)));
  const bestWindowMin = best.length ? Math.round(median(best.map((x) => x.before))) : null;
  const nights = s.filter((e) => {
    const h = hourOf(e.occurred_at);
    return (h >= 18 || h < 1) && len(e) >= 120;
  });
  const bed = nights.length >= 2 ? median(nights.map((e) => (hourOf(e.occurred_at) < 12 ? hourOf(e.occurred_at) + 24 : hourOf(e.occurred_at)))) : null;
  const bedtime = bed === null ? null : `${String(Math.floor(bed) % 24).padStart(2, "0")}:${String(Math.round((bed % 1) * 60)).padStart(2, "0")}`;
  const [lo, hi] = awakeWindow(ageDays);
  let tip = `Her longest naps come after about ${bestWindowMin ?? lo} min awake. Try starting the wind-down around then.`;
  if (napMin && napMin < 40) tip = `Many naps are short, about ${napMin} min. A darker room and white noise can help her link sleep cycles.`;
  if (bestWindowMin && bestWindowMin > hi + 15) tip = `She naps best after ${bestWindowMin} min awake, longer than usual for her age (${lo} to ${hi}). That is fine if she is content.`;
  return { napMin, bestWindowMin, bedtime, naps: naps.length, tip };
}
