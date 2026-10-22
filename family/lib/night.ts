/**
 * The child's night: the hours between bedtime and morning. During them a wake-up is a
 * night wake-up (LanaNow) and the screen goes very dark (NightScreen). The window lives in
 * the child's settings (night_from, night_to, "hh:mm"); these are the defaults everywhere,
 * the same ones the database uses for the stats.
 */
export const NIGHT_FROM = "19:00";
export const NIGHT_TO = "07:00";
const HHMM = /^([01]\d|2[0-3]):[0-5]\d/;

/** The night window from a subject's settings (or a me() subject), with the defaults when unset or malformed. */
export function nightWindow(settings: object | null | undefined): {
  from: string;
  to: string;
} {
  const pick = (key: string, fallback: string) => {
    const v = (settings as Record<string, unknown> | null | undefined)?.[key];
    return typeof v === "string" && HHMM.test(v) ? v.slice(0, 5) : fallback;
  };
  return {
    from: pick("night_from", NIGHT_FROM),
    to: pick("night_to", NIGHT_TO),
  };
}

/** The wall clock in a time zone as "hh:mm", 24-hour. */
export function hhmmIn(at: Date | number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(at);
}

/** Whether "hh:mm" falls inside the window. A window that crosses midnight (19:00 to 07:00) wraps. */
export function inNight(hhmm: string, from: string, to: string): boolean {
  if (from === to) return false;
  return from > to ? hhmm >= from || hhmm < to : hhmm >= from && hhmm < to;
}

/** Whether it is night for this child right now, in the household's time zone. */
export function isNightAt(
  at: Date | number,
  timeZone: string,
  settings: object | null | undefined,
): boolean {
  const w = nightWindow(settings);
  return inNight(hhmmIn(at, timeZone), w.from, w.to);
}
