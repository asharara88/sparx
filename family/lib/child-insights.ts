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

/** Developmental phases by age in days (common paediatric guidance, not a diagnosis). */
const PHASES: { from: number; to: number; what: string }[] = [
  { from: 14, to: 21, what: "Growth spurt (2 to 3 weeks): cluster feeding" },
  { from: 38, to: 46, what: "Growth spurt (6 weeks)" },
  { from: 84, to: 100, what: "Growth spurt (3 months)" },
  { from: 90, to: 150, what: "4-month sleep change: more waking and short naps for a few weeks; stop swaddling at the first sign of rolling" },
  { from: 120, to: 300, what: "Teething window (first tooth usually 4 to 10 months, often about 6)" },
  { from: 165, to: 195, what: "Solids readiness around 6 months, and a growth spurt" },
  { from: 180, to: 270, what: "3-to-2 nap change (often 7 to 9 months)" },
  { from: 240, to: 300, what: "8 to 10 months: crawling and standing, separation anxiety, growth spurt around 9 months" },
  { from: 355, to: 380, what: "12 months: walking and words" },
];

export interface AgeOutlook {
  ageDays: number;
  ageMonths: number;
  awakeWindowMin: [number, number];
  now: string[];
  next: { what: string; inAboutDays: number }[];
}

/** Which phases she is in now and which come next. */
export function ageOutlook(ageDays: number): AgeOutlook {
  return {
    ageDays,
    ageMonths: Math.round((ageDays / 30.44) * 10) / 10,
    awakeWindowMin: awakeWindow(ageDays),
    now: PHASES.filter((p) => ageDays >= p.from && ageDays <= p.to).map((p) => p.what),
    next: PHASES.filter((p) => p.from > ageDays).slice(0, 3).map((p) => ({ what: p.what, inAboutDays: p.from - ageDays })),
  };
}

export interface ScheduleLine {
  at: string;
  what: string;
}

/**
 * A gentle day rhythm from a morning wake time: naps after her awake window
 * (her best recent one when known, else the age norm), feeds on waking, a
 * bedtime routine 30 min before a 18:30 to 20:30 bedtime. A guide, not a timetable.
 */
export function daySchedule(wakeMinutes: number, ageDays: number, bestWindowMin: number | null): { awakeWindowMin: number; basedOn: "her best recent window" | "age norm"; lines: ScheduleLine[] } {
  const [lo, hi] = awakeWindow(ageDays);
  const win = Math.round(Math.min(hi, Math.max(lo, bestWindowMin ?? (lo + hi) / 2)));
  const nap = ageDays < 150 ? 45 : 75;
  const hm = (x: number) => `${String(Math.floor(x / 60) % 24).padStart(2, "0")}:${String(Math.round(x % 60)).padStart(2, "0")}`;
  let t = wakeMinutes;
  const lines: ScheduleLine[] = [{ at: hm(t), what: "wake and feed" }];
  while (t + win + nap < 18 * 60 + 30) {
    t += win;
    lines.push({ at: hm(t), what: `nap (about ${nap} min)` });
    t += nap;
    lines.push({ at: hm(t), what: "wake and feed" });
  }
  const bed = Math.min(Math.max(t + win, 18 * 60 + 30), 20 * 60 + 30);
  lines.push({ at: hm(bed - 30), what: "bedtime routine" }, { at: hm(bed), what: "asleep for the night" });
  return { awakeWindowMin: win, basedOn: bestWindowMin ? "her best recent window" : "age norm", lines };
}

export interface NextNap {
  /** She is asleep now, since this time (ISO). at is null then. */
  asleepSince: string | null;
  /** When the next sleep is likely due, ms since epoch; null when asleep or nothing to go on. */
  at: number | null;
  /** The awake window used, minutes. */
  windowMin: number;
  basis: "her rhythm" | "her age";
  /** The window ends in the evening: it is bedtime, not a nap. */
  isBedtime: boolean;
  /** Minutes awake so far (0 when asleep). */
  awakeMin: number;
  /** The last wake-up used, ISO. */
  since: string | null;
}

/**
 * The next nap, recalculated from where the day actually is: the last wake-up
 * plus her own awake window when the log shows one (the window before her
 * best naps, kept inside a sensible range for her age), else the age norm.
 * A late nap moves everything after it, which is the whole point.
 */
export function nextNap(entries: EntryRow[], ageDays: number, now: number, hourOf: (iso: string) => number): NextNap | null {
  const sleeps = entries.filter((e) => e.type_id === "lana.sleep" && now - t(e.occurred_at) < 36 * 3_600_000 && t(e.occurred_at) <= now + 5 * MIN).sort((a, b) => t(a.occurred_at) - t(b.occurred_at));
  const open = [...sleeps].reverse().find((e) => !e.ended_at && now - t(e.occurred_at) < 16 * 3_600_000);
  const [lo, hi] = awakeWindow(ageDays);
  const coach = sleepCoach(entries, ageDays, hourOf);
  const own = coach?.bestWindowMin ?? null;
  const windowMin = own != null && coach && coach.naps >= 6 ? Math.round(Math.min(hi + 30, Math.max(lo - 15, own))) : Math.round((lo + hi) / 2);
  const basis: NextNap["basis"] = own != null && coach && coach.naps >= 6 ? "her rhythm" : "her age";
  if (open) return { asleepSince: open.occurred_at, at: null, windowMin, basis, isBedtime: false, awakeMin: 0, since: null };
  const ended = sleeps.filter((e) => e.ended_at && t(e.ended_at!) <= now + 5 * MIN);
  const last = ended[ended.length - 1];
  if (!last) return null;
  const since = last.ended_at!;
  const at = t(since) + windowMin * MIN;
  const h = hourOf(new Date(at).toISOString());
  return { asleepSince: null, at, windowMin, basis, isBedtime: h >= 18.5 || h < 5, awakeMin: Math.max(0, Math.round((now - t(since)) / MIN)), since };
}
