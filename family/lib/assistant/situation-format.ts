/**
 * The pure half of the situation snapshot (no "@/" imports, so the unit tests
 * can load it). situation.ts adds the phase line and the loader.
 */
export interface SituationInput {
  name: string;
  nowLocal: string;
  ageDays: number | null;
  /** Object pronoun for the child: her, him, them. */
  them?: string;
  asleepSince: string | null;
  /** When the last sleep ended, if the child is awake and a sleep was logged. */
  awakeSince?: string | null;
  lastFeedAt: string | null;
  lastFeedMl: number | null;
  lastFeedKind: string | null;
  nextFeedDue: string | null;
  lastDiaperAt?: string | null;
  lastDiaperKind?: string | null;
  feedsToday: number;
  diapersToday: number;
  /** Meals today once the child eats (lib/stage); null before. */
  mealsToday?: number | null;
  whoHas: string | null;
  plan: { goal: string; day: number; days: number; todayStep: string | null; doneToday: boolean } | null;
  /** Optional phase line, added by the caller that knows her age. */
  phase?: string | null;
  /** Last night, from the daily stats; null when nothing was logged. */
  lastNight?: { sleepMin: number; wakes: number; feeds: number; longestMin: number } | null;
  /** The last week's averages over the days that have entries; null under three such days. */
  week?: { days: number; feeds: number; bottleMl: number; sleepMin: number; nightMin: number } | null;
}

/** "1 h 20 min", "45 min", "0 min". */
export function hm(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  return h ? `${h} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`;
}

/** Minutes between two "YYYY-MM-DD HH:MM" local stamps; null when either is missing or odd. */
export function minutesBetween(from: string | null | undefined, to: string | null | undefined): number | null {
  if (!from || !to) return null;
  const a = Date.parse(from.replace(" ", "T") + ":00Z");
  const b = Date.parse(to.replace(" ", "T") + ":00Z");
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? Math.round((b - a) / 60_000) : null;
}

export function formatSituation(s: SituationInput): string {
  const them = s.them ?? "her";
  const lines: string[] = [];
  const awakeFor = minutesBetween(s.awakeSince, s.nowLocal);
  lines.push(`${s.name} right now: ${s.asleepSince ? `asleep since ${s.asleepSince.slice(11)}` : s.awakeSince ? `awake since ${s.awakeSince.slice(11)}${awakeFor != null ? ` (${hm(awakeFor)})` : ""}` : "awake"}.`);
  if (s.lastFeedAt) {
    const what = [s.lastFeedMl ? `${s.lastFeedMl} ml` : null, s.lastFeedKind].filter(Boolean).join(" ");
    lines.push(`Last feed ${s.lastFeedAt.slice(11)}${what ? ` (${what})` : ""}${s.nextFeedDue ? `, next due about ${s.nextFeedDue.slice(11)}` : ""}.`);
  } else lines.push("No feed logged yet today.");
  if (s.lastDiaperAt) lines.push(`Last diaper ${s.lastDiaperAt.slice(11)}${s.lastDiaperKind ? ` (${s.lastDiaperKind.toLowerCase()})` : ""}.`);
  lines.push(`Today so far: ${s.feedsToday} feeds, ${s.diapersToday} diapers${s.mealsToday != null ? `, ${s.mealsToday} meal${s.mealsToday === 1 ? "" : "s"}` : ""}.${s.whoHas ? ` ${s.whoHas} has ${them}.` : ""}`);
  if (s.lastNight) lines.push(`Last night: ${hm(s.lastNight.sleepMin)} of sleep, longest stretch ${hm(s.lastNight.longestMin)}, ${s.lastNight.wakes} wake-up${s.lastNight.wakes === 1 ? "" : "s"}, ${s.lastNight.feeds} night feed${s.lastNight.feeds === 1 ? "" : "s"}.`);
  if (s.week) lines.push(`Usual day lately (${s.week.days} days): about ${s.week.feeds} feeds${s.week.bottleMl ? ` and ${s.week.bottleMl} ml of bottles` : ""}, ${hm(s.week.sleepMin)} of sleep, ${hm(s.week.nightMin)} of it at night.`);
  if (s.phase) lines.push(s.phase);
  if (s.plan) lines.push(`Active plan "${s.plan.goal}", day ${s.plan.day} of ${s.plan.days}${s.plan.todayStep ? `: ${s.plan.todayStep}` : ""} (${s.plan.doneToday ? "ticked done today" : "not ticked yet today"}).`);
  return lines.join("\n");
}

export interface HomeNow {
  name: string;
  inHouse: boolean | null;
  /** "Away until 2026-11-05", "Lives here"… */
  label: string | null;
  worksToday: boolean;
}

/** One line on who is in the house; empty when nothing is known. */
export function formatHome(members: HomeNow[]): string {
  if (!members.length) return "";
  const here = members.filter((m) => m.inHouse === true).map((m) => m.name);
  const away = members.filter((m) => m.inHouse === false).map((m) => `${m.name}${m.label ? ` (${m.label.toLowerCase()})` : ""}`);
  const working = members.filter((m) => m.worksToday).map((m) => m.name);
  const parts = [here.length ? `In the house: ${here.join(", ")}.` : "", away.length ? `Away: ${away.join(", ")}.` : "", working.length ? `Working today: ${working.join(", ")}.` : ""].filter(Boolean);
  return parts.length ? `Household now: ${parts.join(" ")}` : "";
}

/** "Milk at home: fridge 270 ml in 2 bottles, freezer 360 ml in 2 bags." (the stash, for the helper). */
export function formatMilk(m: { fridge_ml: number; fridge_count: number; freezer_ml: number; freezer_count: number } | null): string | null {
  if (!m) return null;
  const part = (where: string, ml: number, n: number, unit: string) => (n > 0 ? `${where} ${ml} ml in ${n} ${unit}${n === 1 ? "" : "s"}` : `${where} empty`);
  return `Milk at home: ${part("fridge", m.fridge_ml, m.fridge_count, "bottle")}, ${part("freezer", m.freezer_ml, m.freezer_count, "bag")}.`;
}
