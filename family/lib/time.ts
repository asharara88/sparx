/** Time helpers. Everything is shown in the household's timezone (Asia/Dubai by default). */

export function fmtTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(new Date(iso));
}

/**
 * "Wed 14 Oct", "Wednesday 14 October 2026". Built from the parts, not from
 * Intl's own punctuation: ICU versions differ on the comma after the weekday
 * in en-GB, and the server (Node) and the phone (its browser) rarely share
 * one, which made React throw the whole server render away on every page
 * that shows a date.
 */
export function fmtDate(iso: string, tz: string, opts: Intl.DateTimeFormatOptions = {}): string {
  return dateWords(new Date(iso), { weekday: "short", day: "numeric", month: "short", timeZone: tz, ...opts });
}

/** The parts of an Intl format in Intl's order, separated by single spaces; only the colon inside a time survives. */
export function dateWords(date: Date, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-GB", opts)
    .formatToParts(date)
    .map((p) => (p.type === "literal" ? (p.value.trim() === ":" ? ":" : " ") : p.value))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/** When something happened, the way people say it: "today 08:00", "yesterday 23:10", older "Sat 19 Sept". */
export function fmtWhen(iso: string, tz: string, now: Date = new Date()): string {
  const day = ymdInZone(new Date(iso), tz);
  const today = todayYmd(tz, now);
  if (day === today) return `today ${fmtTime(iso, tz)}`;
  if (day === addDays(today, -1)) return `yesterday ${fmtTime(iso, tz)}`;
  return fmtDate(iso, tz);
}

export function fmtDateTime(iso: string, tz: string): string {
  return `${fmtDate(iso, tz)} ${fmtTime(iso, tz)}`;
}

/**
 * An ISO instant inside a sentence, whole: seconds, fractional seconds and the
 * offset included, as Postgres writes them ("2026-10-21T05:15:24.591871+00:00").
 * A match that stopped early left the fraction on screen and, with no offset,
 * parsed as local time, which differs between the server and the phone.
 */
export const ISO_IN_TEXT = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g;

/** "2 h 10 min ago", "just now", "in 40 min" — plain words, no abbreviations a 70-year-old would not know. */
export function ago(iso: string, now: Date = new Date()): string {
  const diffMin = Math.round((now.getTime() - new Date(iso).getTime()) / 60000);
  const abs = Math.abs(diffMin);
  let text: string;
  if (abs < 1) return "just now";
  if (abs < 60) text = `${abs} min`;
  else if (abs < 60 * 24) text = `${Math.floor(abs / 60)} h ${abs % 60 ? `${abs % 60} min` : ""}`.trim();
  else text = `${Math.floor(abs / (60 * 24))} day${abs >= 60 * 48 ? "s" : ""}`;
  return diffMin >= 0 ? `${text} ago` : `in ${text}`;
}

export function minutesBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);
}

export function fmtDuration(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Local day boundaries (as ISO) for a YYYY-MM-DD date in the given timezone. */
export function dayRange(dateYmd: string, tz: string): { from: string; to: string } {
  // To the next local midnight, not start + 24 h: a clock-change day is 23 or 25 hours long.
  return { from: zonedMidnight(dateYmd, tz).toISOString(), to: zonedMidnight(addDays(dateYmd, 1), tz).toISOString() };
}

/** The Date for 00:00 of a calendar day in a timezone. */
export function zonedMidnight(dateYmd: string, tz: string): Date {
  const [y, m, d] = dateYmd.split("-").map(Number);
  // Start from the UTC instant for that date, then correct by the zone offset at that instant.
  const guess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const offsetMin = tzOffsetMinutes(guess, tz);
  return new Date(guess.getTime() - offsetMin * 60000);
}

function tzOffsetMinutes(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - date.getTime()) / 60000);
}

/** YYYY-MM-DD of "today" in the timezone. */
export function todayYmd(tz: string, now: Date = new Date()): string {
  return ymdInZone(now, tz);
}

export function ymdInZone(date: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  return parts; // en-CA gives YYYY-MM-DD
}

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/** For <input type="datetime-local">: local wall-clock string in the household timezone. */
export function toLocalInput(iso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/**
 * A time the helper was given, in the household's clock: "2026-10-11",
 * "2026-10-11 14:10", "2026-10-11T14:10" or an ISO instant. Null when it is
 * none of those, so a misheard or malformed time is a question back, never
 * "now" by accident.
 */
export function parseHouseholdTime(s: string | null | undefined, tz: string): string | null {
  const t = (s ?? "").trim();
  if (!t) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.exec(t);
  if (!m) return null;
  const [, y, mo, d, hh = "00", mm = "00", offset] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm)));
  // A 13th month or a 32nd day rolls over in Date; the round trip catches it.
  if (date.toISOString().slice(0, 16) !== `${y}-${mo}-${d}T${hh}:${mm}`) return null;
  if (offset) {
    const instant = new Date(t); // an offset like +24:00 or +99:99 passes the regex but not Date
    return isNaN(instant.getTime()) ? null : instant.toISOString();
  }
  return fromLocalInput(`${y}-${mo}-${d}T${hh}:${mm}`, tz);
}

/**
 * Inverse of toLocalInput: wall-clock in tz -> ISO instant. The zone's offset is
 * taken at that wall time, not at midnight, so a time on a daylight-saving
 * changeover day lands where the clock said (a time inside the skipped hour
 * resolves to the instant the clock showed next).
 */
export function fromLocalInput(local: string, tz: string): string {
  const [datePart, timePart] = local.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const [hh, mm] = (timePart ?? "00:00").split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm, 0);
  // First guess with the offset at that wall time read as UTC, then once more with
  // the offset at the instant that guess gave: two passes settle a changeover.
  let instant = wall - tzOffsetMinutes(new Date(wall), tz) * 60000;
  instant = wall - tzOffsetMinutes(new Date(instant), tz) * 60000;
  return new Date(instant).toISOString();
}

/**
 * A list row's detail ("Left breast", "Cot", "Bottle · 120 ml"): the payload in words, with
 * the side and "Breast" as one word, and without the minutes when the row shows the length.
 */
export function entryDetail(payload: Record<string, unknown>, lengthShown: boolean): string {
  const { duration_min, method, side, ...rest } = payload;
  const p: Record<string, unknown> = {};
  if (method === "Breast" && typeof side === "string" && side) p.side = side === "Both" ? "Both breasts" : `${side} breast`;
  else Object.assign(p, { method, side });
  if (!lengthShown) p.duration_min = duration_min;
  return describePayload({ ...p, ...rest });
}

export function describePayload(payload: Record<string, unknown>): string {
  return Object.entries(payload)
    .filter(([, v]) => v !== null && v !== "" && v !== undefined)
    // A meal's yes/no and "None" details say nothing unless they say something.
    .filter(([k, v]) => !((k === "new_food" && v !== "Yes") || ((k === "allergen" || k === "reaction") && v === "None")))
    // Links and flags the app keeps for itself ("medicine_id", a uuid, "early": true) are not
    // words a person reads: a link is dropped, a flag that is on says its name, one off says nothing.
    .filter(([k, v]) => !k.endsWith("_id") && v !== false && typeof v !== "object" && !(typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(v)))
    .map(([k, v]) => {
      if (v === true) return k === "early" ? "given early" : k.replace(/_/g, " ");
      if (k === "new_food") return "first time";
      if (k === "allergen") return `allergen: ${String(v).toLowerCase()}`;
      if (k === "reaction") return `reaction: ${String(v).toLowerCase()}`;
      if (k === "amount_ml") return `${v} ml`;
      if (k === "duration_min") return `${v} min`;
      if (k === "weight_kg") return `${v} kg`;
      if (k === "length_cm") return `${v} cm`;
      if (k === "amount_g") return `${v} g`;
      if (k === "next_due") return `next ${v}`;
      return String(v);
    })
    .join(" · ");
}
