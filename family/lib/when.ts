/**
 * "When did it happen?" for logging after the fact: now, a few minutes ago,
 * or at a clock time. Pure, so the one-tap screen, the sleep shortcut and the
 * backfill card all agree on the arithmetic.
 */

export type When = { kind: "now" } | { kind: "ago"; min: number } | { kind: "at"; local: string };

/** The quick "ago" choices, in minutes. */
export const AGO_PRESETS = [15, 30, 45, 60, 90, 120, 180] as const;

export const NOW: When = { kind: "now" };

export function agoLabel(min: number): string {
  if (min < 60) return `${min} min ago`;
  const h = min / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} h ago`;
}

/** The instant a When points at, ISO. `fromLocal` turns a datetime-local string in the household zone into ISO. */
export function whenToIso(w: When, nowMs: number, fromLocal: (local: string) => string): string {
  if (w.kind === "now") return new Date(nowMs).toISOString();
  if (w.kind === "ago") return new Date(nowMs - w.min * 60_000).toISOString();
  return fromLocal(w.local);
}

/** True when the entry is being written for a moment other than now. */
export function isEarlier(w: When): boolean {
  return w.kind !== "now";
}

/** Minutes between the start and now, for a "lasted" default that cannot run past now. */
export function maxDurationMin(startIso: string, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - Date.parse(startIso)) / 60_000));
}

/** "Earlier" offers clock times, not offsets: every `stepMin` mark before now, newest first. */
export const MARK_STEP_MIN = 10;
export const MARK_COUNT = 12;

/**
 * The clock-time choices for "earlier" as datetime-local strings in the household zone:
 * the last `count` marks on the `stepMin` grid (13:50, 13:40, …), skipping a mark under
 * 5 minutes old (that is "now"). `toLocal` turns an ISO instant into a local string.
 */
export function clockMarks(nowMs: number, toLocal: (iso: string) => string, count = MARK_COUNT, stepMin = MARK_STEP_MIN): string[] {
  if (count <= 0) return [];
  const local = toLocal(new Date(nowMs).toISOString());
  const intoStep = Number(local.slice(14, 16)) % stepMin;
  let mark = nowMs - (nowMs % 60_000) - intoStep * 60_000;
  if (nowMs - mark < 5 * 60_000) mark -= stepMin * 60_000;
  return Array.from({ length: count }, (_, i) => toLocal(new Date(mark - i * stepMin * 60_000).toISOString()));
}

/** How long a time picked for an entry from earlier carries over to the next sheet. */
export const RECALL_MS = 60_000;

/**
 * The "when" a log sheet opens with: the time just used for an entry from earlier, if
 * that was under a minute ago (a bottle and a nappy from the same moment), else now. A
 * one-tap tile never uses it, so a direct tap is never quietly backdated.
 */
export function recallWhen(last: { when: When; at: number } | null, nowMs: number): When {
  if (!last || last.when.kind === "now") return NOW;
  const age = nowMs - last.at;
  return age >= 0 && age < RECALL_MS ? last.when : NOW;
}
