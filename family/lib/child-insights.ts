import type { EntryRow } from "@/lib/types";
import { awakeWindow, defaultNaps, isToddler, type Stage } from "./stage.ts";
import { fmtDuration, zonedMidnight } from "./time.ts";
import { cap, pronouns } from "./names.ts";
import { leapWeek } from "./leaps.ts";
import { ageDays as daysOld, ageWords } from "./norms.ts";
import { napWindow } from "./backlog.ts";

/**
 * What her own log says about her rhythm: a possible growth spurt, and a sleep
 * coach (usual nap, the awake window before her best naps, usual bedtime).
 * Estimates, labelled as such on screen. Nothing here is medical advice.
 *
 * From 12 months the naps follow the child's own days (napPattern): a toddler who has
 * stopped napping gets no nap window, and one who naps once gets one nap, then bedtime.
 */

const D = 86_400_000;
const MIN = 60_000;
const t = (iso: string) => Date.parse(iso);
const median = (xs: number[]) => {
  const v = [...xs].sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : 0;
};

/** Typical awake window in minutes by age: one table for the whole app, in lib/stage. */
export { awakeWindow } from "./stage.ts";

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
  /**
   * The rows under the tip, as the Sleep rhythm fold shows them: usual nap, awake before the
   * best naps, usual bedtime. A toddler's times in hours and minutes; with no daytime nap in
   * the 14 days only the usual bedtime.
   */
  rows: { label: string; value: string }[];
}

/** A nap: a finished sleep that starts from 07:00 to before 18:00 and lasts under 4 hours. */
const isNap = (e: Pick<EntryRow, "occurred_at" | "ended_at">, hourOf: (iso: string) => number) => {
  if (!e.ended_at) return false;
  const h = hourOf(e.occurred_at);
  return h >= 7 && h < 18 && (t(e.ended_at) - t(e.occurred_at)) / MIN < 240;
};

/**
 * From 14 days of sleeps: usual nap length, the awake window before her best naps, usual
 * bedtime, one tip. `sex` is the child's recorded sex, for the tip's pronouns. `napsPerDay`
 * is the toddler's pattern (napPattern's perDay; null for none known), which sets the usual
 * awake window from 12 to 17 months; it is not read for a baby. For a toddler the learner
 * keeps awake stretches up to 8 hours (5 for a baby) and writes times in hours and minutes.
 */
export function sleepCoach(entries: EntryRow[], ageDays: number, hourOf: (iso: string) => number, sex: string | null, napsPerDay: number | null): SleepCoach | null {
  const s = entries.filter((e) => e.type_id === "lana.sleep" && e.ended_at).sort((a, b) => t(a.occurred_at) - t(b.occurred_at));
  if (s.length < 6) return null;
  const toddler = isToddler(ageDays);
  const len = (e: EntryRow) => (t(e.ended_at!) - t(e.occurred_at)) / MIN;
  const naps = s.filter((e) => isNap(e, hourOf));
  const napMin = Math.round(median(naps.map(len)));
  // A one-nap toddler is often up 5 to 6 hours before the nap: a cap of 5 hours dropped every one.
  const longest = toddler ? 480 : 300;
  const withWindow = naps
    .map((e) => {
      const prev = s[s.indexOf(e) - 1];
      return prev ? { len: len(e), before: (t(e.occurred_at) - t(prev.ended_at!)) / MIN } : null;
    })
    .filter((x): x is { len: number; before: number } => !!x && x.before > 15 && x.before < longest);
  const best = [...withWindow].sort((a, b) => b.len - a.len).slice(0, Math.max(2, Math.ceil(withWindow.length / 4)));
  const bestWindowMin = best.length ? Math.round(median(best.map((x) => x.before))) : null;
  const nights = s.filter((e) => {
    const h = hourOf(e.occurred_at);
    return (h >= 18 || h < 1) && len(e) >= 120;
  });
  const bed = nights.length >= 2 ? median(nights.map((e) => (hourOf(e.occurred_at) < 12 ? hourOf(e.occurred_at) + 24 : hourOf(e.occurred_at)))) : null;
  const bedtime = bed === null ? null : `${String(Math.floor(bed) % 24).padStart(2, "0")}:${String(Math.round((bed % 1) * 60)).padStart(2, "0")}`;
  const [lo, hi] = awakeWindow(ageDays, napsPerDay);
  const p = pronouns(sex);
  // A baby's awake times stay in minutes, as they always were; a toddler's are hours and minutes.
  const awake = (min: number) => (toddler ? fmtDuration(min) : `${min} min`);
  const usual = toddler ? `${fmtDuration(lo)} to ${fmtDuration(hi)}` : `${lo} to ${hi}`;
  let tip = `${cap(p.their)} longest naps come after about ${awake(bestWindowMin ?? lo)} awake. Try starting the wind-down around then.`;
  if (napMin && napMin < 40) tip = `Many naps are short, about ${napMin} min. A darker room and white noise can help ${p.them} link sleep cycles.`;
  if (bestWindowMin && bestWindowMin > hi + 15) tip = `${cap(p.they)} nap${p.s} best after ${awake(bestWindowMin)} awake, longer than usual for ${p.their} age (${usual}). That is fine if ${p.they} ${p.is} content.`;
  const rows = [
    { label: "Usual nap", value: napMin ? awake(napMin) : "—" },
    { label: "Awake before the best naps", value: bestWindowMin ? awake(bestWindowMin) : "—" },
    { label: "Usual bedtime", value: bedtime ?? "—" },
  ];
  if (toddler && !naps.length) return { napMin, bestWindowMin, bedtime, naps: 0, tip: "No daytime naps in the last 14 days.", rows: rows.slice(2) };
  return { napMin, bestWindowMin, bedtime, naps: naps.length, tip, rows };
}

export interface NapPattern {
  /** 12 months or older. For a baby nothing below is used: naps go by the age as before. */
  toddler: boolean;
  /** A nap is expected today. Always true for a baby. */
  expected: boolean;
  /** A toddler's naps a day: 2 or 1 while napping, 0 when no nap is expected. Null for a baby.
   *  It sets the awake window, so it stops at two (there is no window for three). */
  perDay: number | null;
  /** The naps a toddler usually has, not stopped at two: the day turns to bedtime only after
   *  this many, so a child still on three naps is not sent to bed after the second. */
  usualNaps: number | null;
  /** Whole days before today, inside the entries given, with any sleep logged. */
  evidenceDays: number;
  /** Of those, the days with a nap. */
  napDays: number;
  /** Naps already finished today. */
  napsToday: number;
}

/**
 * Does the child nap, and how many times a day, from their own log (R5). The one place
 * Home's card and strip, the nap push and the helper ask.
 *
 * Evidence days are whole days before today, on the home's calendar (`tz`), that lie inside
 * what was fetched (from `fromMs`; Home's week gives the 6 days before today) and have a
 * sleep logged. A nap is a finished sleep starting from 07:00 to before 18:00 that lasted
 * under 4 hours. A toddler is expected to nap when naps were logged on 3 or more evidence
 * days or on at least half of them; with fewer than 3 evidence days, also whenever the child
 * is under 3 years. Naps a day: the median of the nap days (2 or more is two); with no nap
 * day to go by, two before 15 months and one from 15 months. The bedtime count
 * (`usualNaps`) is the same median without the stop at two.
 */
export function napPattern(entries: readonly Pick<EntryRow, "type_id" | "occurred_at" | "ended_at">[], ageDays: number | null, nowMs: number, tz: string, fromMs: number): NapPattern {
  const dayOf = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  const hourFmt = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "numeric", minute: "numeric", hourCycle: "h23" });
  const hourOf = (iso: string) => {
    const p = hourFmt.formatToParts(new Date(iso));
    return Number(p.find((x) => x.type === "hour")?.value ?? 0) + Number(p.find((x) => x.type === "minute")?.value ?? 0) / 60;
  };
  const today = dayOf.format(nowMs);
  const perDayNaps = new Map<string, number>();
  let napsToday = 0;
  for (const e of entries) {
    if (e.type_id !== "lana.sleep" || t(e.occurred_at) > nowMs) continue;
    const day = dayOf.format(t(e.occurred_at));
    const nap = isNap(e, hourOf) && t(e.ended_at!) <= nowMs;
    if (day === today) {
      if (nap) napsToday++;
      continue;
    }
    if (day > today || zonedMidnight(day, tz).getTime() < fromMs) continue;
    perDayNaps.set(day, (perDayNaps.get(day) ?? 0) + (nap ? 1 : 0));
  }
  const evidenceDays = perDayNaps.size;
  const napCounts = [...perDayNaps.values()].filter((n) => n > 0);
  const napDays = napCounts.length;
  if (!isToddler(ageDays)) return { toddler: false, expected: true, perDay: null, usualNaps: null, evidenceDays, napDays, napsToday };
  const under3 = ageDays! / 30.4375 < 36;
  const expected = napDays >= 3 || (evidenceDays > 0 && napDays * 2 >= evidenceDays) || (evidenceDays < 3 && under3);
  const usualNaps = !expected ? 0 : napDays ? median(napCounts) : defaultNaps(ageDays!);
  const perDay = Math.min(2, usualNaps);
  return { toddler: true, expected, perDay, usualNaps, evidenceDays, napDays, napsToday };
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
    awakeWindowMin: awakeWindow(ageDays, null),
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
 * For a toddler: no feeds on waking (milk has no clock from 12 months), and no more naps
 * than `napsPerDay` (napPattern's perDay: 0 plans none; null, the default for the age).
 * `napsPerDay` is not read for a baby.
 */
export function daySchedule(wakeMinutes: number, ageDays: number, bestWindowMin: number | null, napsPerDay: number | null): { awakeWindowMin: number; basedOn: "her best recent window" | "age norm"; lines: ScheduleLine[] } {
  const toddler = isToddler(ageDays);
  const [lo, hi] = awakeWindow(ageDays, napsPerDay);
  const win = Math.round(Math.min(hi, Math.max(lo, bestWindowMin ?? (lo + hi) / 2)));
  const nap = ageDays < 150 ? 45 : 75;
  const most = toddler ? (napsPerDay ?? defaultNaps(ageDays)) : Infinity;
  const woke = toddler ? "wake" : "wake and feed";
  const hm = (x: number) => `${String(Math.floor(x / 60) % 24).padStart(2, "0")}:${String(Math.round(x % 60)).padStart(2, "0")}`;
  let t = wakeMinutes;
  const lines: ScheduleLine[] = [{ at: hm(t), what: woke }];
  for (let n = 0; n < most && t + win + nap < 18 * 60 + 30; n++) {
    t += win;
    lines.push({ at: hm(t), what: `nap (about ${nap} min)` });
    t += nap;
    lines.push({ at: hm(t), what: woke });
  }
  const bed = Math.min(Math.max(t + win, 18 * 60 + 30), 20 * 60 + 30);
  lines.push({ at: hm(bed - 30), what: "bedtime routine" }, { at: hm(bed), what: "asleep for the night" });
  return { awakeWindowMin: win, basedOn: bestWindowMin ? "her best recent window" : "age norm", lines };
}

export interface NextNap {
  /** She is asleep now, since this time (ISO). at is null then. */
  asleepSince: string | null;
  /** When the next sleep is likely due, ms since epoch; null when asleep, when nothing to go on, or for a toddler with no nap expected. */
  at: number | null;
  /** The awake window used, minutes. */
  windowMin: number;
  basis: "her rhythm" | "her age";
  /** The window ends in the evening, or a toddler has had today's naps: it is bedtime, not a nap. */
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
 *
 * For a toddler, `pattern` (napPattern over the same entries) decides: no nap expected
 * gives no window (`at` null, not asleep); once today's naps reach the pattern's count the
 * next window is bedtime, whatever the hour. `pattern` is not read for a baby.
 */
export function nextNap(entries: EntryRow[], ageDays: number, now: number, hourOf: (iso: string) => number, pattern: NapPattern): NextNap | null {
  const sleeps = entries.filter((e) => e.type_id === "lana.sleep" && now - t(e.occurred_at) < 36 * 3_600_000 && t(e.occurred_at) <= now + 5 * MIN).sort((a, b) => t(a.occurred_at) - t(b.occurred_at));
  const open = [...sleeps].reverse().find((e) => !e.ended_at && now - t(e.occurred_at) < 16 * 3_600_000);
  const toddler = isToddler(ageDays);
  const naps = toddler ? pattern.perDay : null;
  const [lo, hi] = awakeWindow(ageDays, naps);
  const coach = sleepCoach(entries, ageDays, hourOf, null, naps);
  const own = coach?.bestWindowMin ?? null;
  const windowMin = own != null && coach && coach.naps >= 6 ? Math.round(Math.min(hi + 30, Math.max(lo - 15, own))) : Math.round((lo + hi) / 2);
  const basis: NextNap["basis"] = own != null && coach && coach.naps >= 6 ? "her rhythm" : "her age";
  if (open) return { asleepSince: open.occurred_at, at: null, windowMin, basis, isBedtime: false, awakeMin: 0, since: null };
  const ended = sleeps.filter((e) => e.ended_at && t(e.ended_at!) <= now + 5 * MIN);
  const last = ended[ended.length - 1];
  if (!last) return null;
  const since = last.ended_at!;
  const awakeMin = Math.max(0, Math.round((now - t(since)) / MIN));
  if (toddler && !pattern.expected) return { asleepSince: null, at: null, windowMin, basis, isBedtime: false, awakeMin, since };
  const at = t(since) + windowMin * MIN;
  const h = hourOf(new Date(at).toISOString());
  const napsDone = toddler && pattern.napsToday >= (pattern.usualNaps ?? 0);
  return { asleepSince: null, at, windowMin, basis, isBedtime: napsDone || h >= 18.5 || h < 5, awakeMin, since };
}

/** What Home's top card says now (DESIGN.md, "Home"), worked out from the state of the day. */
export type TopCard =
  | { kind: "feeding"; since: string }
  | { kind: "asleep"; since: string }
  /** The next-nap or bedtime window: "11:20 – 11:50" (from, to), the bar, and the line under it. */
  | { kind: "window"; label: "Next nap" | "Bedtime"; from: number; to: number; pct: number; windowStartPct: number; untilMin: number; late: number; awakeMin: number; woke: string; say: string }
  /** Over an hour past a nap window: when the child last woke ("If she napped since, log it below."). */
  | { kind: "last_woke"; woke: string }
  | { kind: "awake"; awakeMin: number; woke: string }
  /** A gap in the log: nothing rather than "awake 20 h". */
  | { kind: "nothing" };

/**
 * Home's top card (components/HomeState.tsx): feeding, asleep, the nap or bedtime window,
 * or how long the child has been awake. `stage` is the child's (stageFor), `woke` the last
 * wake-up (ISO), `nap` nextNap's window when it has one. "Awake for" holds 12 hours for a baby and 16 for a toddler (a
 * child with no nap is up 12 to 13 hours); past that the card says nothing. More than an
 * hour past a toddler's bedtime window it is plain "Awake for", never "if she napped since".
 */
export function topCard(c: { stage: Pick<Stage, "toddler" | "limits">; feedingSince: string | null; asleepSince: string | null; woke: string | null; nap: { at: number; isBedtime: boolean } | null; now: number }): TopCard {
  if (c.feedingSince) return { kind: "feeding", since: c.feedingSince };
  if (c.asleepSince) return { kind: "asleep", since: c.asleepSince };
  if (!c.woke) return { kind: "nothing" };
  const awakeMin = Math.max(0, Math.round((c.now - t(c.woke)) / MIN));
  if (awakeMin > c.stage.limits.awakeKnownMin) return { kind: "nothing" };
  const w = c.nap ? napWindow(t(c.woke), c.nap.at, c.now) : null;
  if (w && c.nap && w.late > 60) return c.stage.toddler && c.nap.isBedtime ? { kind: "awake", awakeMin, woke: c.woke } : { kind: "last_woke", woke: c.woke };
  if (w && c.nap) {
    const say = w.late > 0 ? `Past the window by ${fmtDuration(w.late)}.` : w.untilMin > 0 ? `In ${fmtDuration(w.untilMin)}. Start winding down.` : "Now. Start winding down.";
    return { kind: "window", label: c.nap.isBedtime ? "Bedtime" : "Next nap", ...w, awakeMin, woke: c.woke, say };
  }
  return { kind: "awake", awakeMin, woke: c.woke };
}

/** "What this age brings" (components/PhaseCard.tsx), as text. */
export interface PhaseCardText {
  heading: string;
  /** The phases of now, one line each (a baby). */
  now: string[];
  /** "A quieter stretch: ..." when a baby is in no phase; null otherwise. */
  quiet: string | null;
  /** "Coming up: ...", or null. */
  coming: string | null;
  /** The small line at the foot. */
  foot: string;
  /** The link to Week by week, its whole text with the "›"; null with no stretch. */
  link: string | null;
}

/**
 * The card for a child with a birth date, on `today`. A baby's as it has always been
 * ("What to expect at 5.4 months", the phases, the awake window). A toddler's is the
 * heading in age words, one link to the current Week by week stretch and "Every child
 * differs; {name} sets the pace."; null past the last stretch (week 156), and the card is
 * not drawn.
 */
export function phaseCard(birthDate: string, today: string, name: string): PhaseCardText | null {
  const ageDays = daysOld(birthDate, today);
  const w = leapWeek(ageDays);
  if (isToddler(ageDays)) {
    if (!w) return null;
    return { heading: `What to expect at ${ageWords(birthDate, today)}`, now: [], quiet: null, coming: null, foot: `Every child differs; ${name} sets the pace.`, link: `${w.band.title} ›` };
  }
  const o = ageOutlook(ageDays);
  return {
    heading: `What to expect at ${o.ageMonths} months`,
    now: o.now,
    quiet: o.now.length ? null : "A quieter stretch: no big change is usual right now.",
    coming: o.next.length ? `Coming up: ${o.next.map((n) => `${n.what.split(":")[0].toLowerCase()} in about ${n.inAboutDays} days`).join("; ")}.` : null,
    foot: `Usual awake window ${o.awakeWindowMin[0]} to ${o.awakeWindowMin[1]} min. Every baby differs; ${name} sets the pace.`,
    link: w ? `Week ${w.week}: ${w.band.title.toLowerCase()} ›` : null,
  };
}
