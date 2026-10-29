/**
 * Logging what already happened, from Home: the bottle amount to offer first, how long a
 * nap from earlier could have lasted, and whether a sleep would land on top of one already
 * logged. Pure, so it is unit-tested; LanaNow and Backfill use it.
 */

/** Nap lengths offered for a sleep from earlier, minutes. */
export const NAP_LENGTHS = [20, 30, 45, 60, 90, 120] as const;

/** An open sleep older than this is a timer left on, not a sleep (DESIGN.md, rule 6). */
export const STALE_OPEN_SLEEP_MS = 12 * 3_600_000;

/**
 * The bottle chips and the one to mark: the last bottle's amount is the usual one, and it
 * joins the chips (in order) when it is not one of them, so it is always one tap.
 */
export function bottleChoices(quick: readonly number[], lastMl: number | null | undefined): { amounts: number[]; usual: number | null } {
  const usual = lastMl && lastMl > 0 ? Math.round(lastMl) : null;
  const amounts = usual && !quick.includes(usual) ? [...quick, usual].sort((a, b) => a - b) : [...quick];
  return { amounts, usual };
}

/** The nap lengths that end by now for a sleep that started at `startMs`. */
export function napLengths(startMs: number, nowMs: number, lengths: readonly number[] = NAP_LENGTHS): number[] {
  return lengths.filter((m) => startMs + m * 60_000 <= nowMs);
}

interface SleepLike {
  id: string;
  type_id: string;
  occurred_at: string;
  ended_at: string | null;
}

/**
 * The first sleep already logged that shares time with [startMs, endMs). An open sleep
 * runs to now, unless it is older than 12 hours (a timer left on). Touching ends (one nap
 * ends at 13:00, the next starts at 13:00) do not count.
 */
export function overlappingSleep<T extends SleepLike>(entries: readonly T[], startMs: number, endMs: number, nowMs: number, sleepTypeId = "lana.sleep"): T | null {
  for (const e of entries) {
    if (e.type_id !== sleepTypeId) continue;
    const s = Date.parse(e.occurred_at);
    if (!e.ended_at && nowMs - s > STALE_OPEN_SLEEP_MS) continue;
    const end = e.ended_at ? Date.parse(e.ended_at) : nowMs;
    if (s < endMs && end > startMs) return e;
  }
  return null;
}
