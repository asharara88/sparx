/**
 * A member's night, read from what that member saved (DESIGN.md, "Cheers and shared nights").
 * It is a guess, and says so wherever it is shown: the app knows when someone saved a feed
 * at 3 am, not when they slept. It is worked out only for a member who said yes to sharing
 * (members.night_share), and shown only to the other parent, the next morning.
 *
 * The rule, each figure one constant here:
 *   - the night runs from 23:00 to 06:00 at home (or to the child's morning when that is
 *     earlier), and belongs to the day it starts;
 *   - only what the member saved herself counts (logged_by), never what was saved in her name;
 *   - a timed entry (a breastfeed) is time awake from its start to its end, at most 90
 *     minutes; a sleep, or a timer the app closed by itself, is one moment;
 *   - saves within 30 minutes of each other are one time up;
 *   - under two times up, nothing is said at all.
 *
 * Pure: no "@/" imports, so the unit tests run it as it is.
 */
import { addDays, fromLocalInput } from "./time.ts";

export const NIGHT_STARTS = "23:00";
export const NIGHT_ENDS = "06:00";
/** Saves this close together are one time up. */
export const JOIN_MIN = 30;
/** A timer left running does not make a night of it. */
export const BUSY_CAP_MIN = 90;
/** Under this many times up there is no line. */
export const LEAST_TIMES = 2;

export interface NightRow {
  type_id: string;
  occurred_at: string;
  ended_at: string | null;
  payload: Record<string, unknown>;
  logged_by?: string | null;
}
export interface NightWindow {
  from: number;
  to: number;
  /** The home date the night started on (a night cheer is filed under it). */
  day: string;
}
export interface MemberNight {
  times: number;
  longestMin: number;
}

/** The night that ended on the morning of the home date `morning`. */
export function nightOf(morning: string, tz: string, childNightTo?: string | null): NightWindow {
  const ends = childNightTo && /^([01]\d|2[0-3]):[0-5]\d$/.test(childNightTo) && childNightTo < NIGHT_ENDS ? childNightTo : NIGHT_ENDS;
  const day = addDays(morning, -1);
  return { from: Date.parse(fromLocalInput(`${day}T${NIGHT_STARTS}`, tz)), to: Date.parse(fromLocalInput(`${morning}T${ends}`, tz)), day };
}

/** How many times the member was up in that night and the longest quiet stretch; null under two times. */
export function memberNight(rows: NightRow[], memberId: string, win: NightWindow): MemberNight | null {
  const busy = rows
    .filter((r) => r.logged_by === memberId)
    .map((r) => {
      const start = Date.parse(r.occurred_at);
      const timed = !!r.ended_at && r.payload?.auto_end !== true && !r.type_id.endsWith(".sleep");
      const end = timed ? Math.min(Date.parse(r.ended_at as string), start + BUSY_CAP_MIN * 60_000, win.to) : start;
      return { start, end: Math.max(start, end) };
    })
    .filter((b) => Number.isFinite(b.start) && b.start >= win.from && b.start < win.to)
    .sort((a, b) => a.start - b.start);
  const groups: { start: number; end: number }[] = [];
  for (const b of busy) {
    const last = groups[groups.length - 1];
    if (last && b.start <= last.end + JOIN_MIN * 60_000) last.end = Math.max(last.end, b.end);
    else groups.push({ ...b });
  }
  if (groups.length < LEAST_TIMES) return null;
  let longest = groups[0].start - win.from;
  for (let i = 1; i < groups.length; i++) longest = Math.max(longest, groups[i].start - groups[i - 1].end);
  longest = Math.max(longest, win.to - groups[groups.length - 1].end);
  return { times: groups.length, longestMin: Math.round(longest / 60_000) };
}

/**
 * The latest finished night, of the last `back`, that would give a line: what the member is
 * shown before she answers, so she reads the very words the other parent would.
 */
export function latestNight(rows: NightRow[], memberId: string, today: string, tz: string, nowMs: number, childNightTo?: string | null, back = 6): { night: MemberNight; win: NightWindow } | null {
  for (let i = 0; i < back; i++) {
    const win = nightOf(addDays(today, -i), tz, childNightTo);
    if (win.to > nowMs) continue;
    const night = memberNight(rows, memberId, win);
    if (night) return { night, win };
  }
  return null;
}

const count = (times: number) => (times === 2 ? "twice" : `${times} times`);

/** Home's one line, for the other parent: "Sara was up twice in the night". */
export function nightLine(name: string, times: number): string {
  return `${name} was up ${count(times)} in the night`;
}

/** The sheet's first line: "Up 3 times." */
export function timesWords(times: number): string {
  return `Up ${count(times)}.`;
}

/** The longest quiet stretch, rounded down to the half hour: "about 2 h 30 min", "under an hour". */
export function stretchWords(min: number): string {
  if (min < 60) return "under an hour";
  const half = Math.floor(min / 30) * 30;
  const h = Math.floor(half / 60);
  return half % 60 ? `about ${h} h 30 min` : `about ${h} h`;
}

/** "last night", or "Tuesday night" for an earlier one. `day` is the home date the night started on. */
export function nightName(day: string, today: string): string {
  if (day === addDays(today, -1)) return "last night";
  return `${new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`))} night`;
}

/** "Omar", "Omar and Sam", "Omar, Sam and Lee". */
export function andList(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
