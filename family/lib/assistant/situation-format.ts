/**
 * The pure half of the situation snapshot (no "@/" imports, so the unit tests
 * can load it). situation.ts adds the phase line and the loader.
 */
export interface SituationInput {
  name: string;
  nowLocal: string;
  ageDays: number | null;
  asleepSince: string | null;
  lastFeedAt: string | null;
  lastFeedMl: number | null;
  lastFeedKind: string | null;
  nextFeedDue: string | null;
  feedsToday: number;
  diapersToday: number;
  whoHas: string | null;
  plan: { goal: string; day: number; days: number; todayStep: string | null; doneToday: boolean } | null;
  /** Optional phase line, added by the caller that knows her age. */
  phase?: string | null;
}

export function formatSituation(s: SituationInput): string {
  const lines: string[] = [];
  lines.push(`${s.name} right now: ${s.asleepSince ? `asleep since ${s.asleepSince.slice(11)}` : "awake"}.`);
  if (s.lastFeedAt) {
    const what = [s.lastFeedMl ? `${s.lastFeedMl} ml` : null, s.lastFeedKind].filter(Boolean).join(" ");
    lines.push(`Last feed ${s.lastFeedAt.slice(11)}${what ? ` (${what})` : ""}${s.nextFeedDue ? `, next due about ${s.nextFeedDue.slice(11)}` : ""}.`);
  } else lines.push("No feed logged yet today.");
  lines.push(`Today so far: ${s.feedsToday} feeds, ${s.diapersToday} nappies.${s.whoHas ? ` ${s.whoHas} has her.` : ""}`);
  if (s.phase) lines.push(s.phase);
  if (s.plan) lines.push(`Active plan "${s.plan.goal}", day ${s.plan.day} of ${s.plan.days}${s.plan.todayStep ? `: ${s.plan.todayStep}` : ""} (${s.plan.doneToday ? "ticked done today" : "not ticked yet today"}).`);
  return lines.join("\n");
}
