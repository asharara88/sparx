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
