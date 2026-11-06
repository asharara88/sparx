/**
 * Whether the helper may make another model call now. Pure (no "@/" imports, so
 * the unit tests load it on its own); allowance.ts reads the counts and the
 * switches and calls it.
 *
 * Every model call (a question, a brief, a chat read, a milk photo, a week plan)
 * counts once. The limits are per home and per member, per day in the home's own
 * clock; Mido's home (the platform home) has none unless one is set. Two switches
 * on the server cover the whole deployment: ASSISTANT_OTHER_HOMES=off turns the
 * helper off for every other home, ASSISTANT_DAILY_TOTAL caps all homes together
 * (counted per UTC day).
 */

export interface AllowanceCounts {
  home_calls: number;
  member_calls: number;
  /** null: no limit. */
  home_limit: number | null;
  member_limit: number | null;
  total_calls: number;
  platform: boolean;
}

export interface AllowanceSwitches {
  /** ASSISTANT_OTHER_HOMES: "off" turns the helper off for every home but the platform home. */
  otherHomes?: string | null;
  /** ASSISTANT_DAILY_TOTAL: a cap on all homes' calls per UTC day; blank or not a number = none. */
  dailyTotal?: string | null;
}

export type AllowanceDecision = { ok: true } | { ok: false; error: "limit"; message: string };

const off = (v: string | null | undefined) => ["off", "0", "false", "no"].includes((v ?? "").trim().toLowerCase());

/** ASSISTANT_DAILY_TOTAL as a whole number of calls, or null for no cap. */
export function dailyTotal(v: string | null | undefined): number | null {
  const t = (v ?? "").trim();
  return /^\d+$/.test(t) ? Number(t) : null;
}

export function decideAllowance(c: AllowanceCounts, s: AllowanceSwitches): AllowanceDecision {
  if (!c.platform && off(s.otherHomes)) {
    return { ok: false, error: "limit", message: "The helper is switched off for now. Everything else in the app works as usual." };
  }
  const total = dailyTotal(s.dailyTotal);
  if (total != null && c.total_calls >= total) {
    return { ok: false, error: "limit", message: "The helper is resting until midnight. Everything else in the app works as usual." };
  }
  if (c.home_limit != null && c.home_calls >= c.home_limit) {
    return { ok: false, error: "limit", message: `The helper has done ${c.home_limit} ${c.home_limit === 1 ? "thing" : "things"} for this home today. It starts again at midnight.` };
  }
  if (c.member_limit != null && c.member_calls >= c.member_limit) {
    return { ok: false, error: "limit", message: `You have asked the helper ${c.member_limit === 1 ? "once" : `${c.member_limit} times`} today. It starts again at midnight.` };
  }
  return { ok: true };
}
