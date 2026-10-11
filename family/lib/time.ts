/** Time helpers. Everything is shown in the household's timezone (Asia/Dubai by default). */

export function fmtTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(new Date(iso));
}

export function fmtDate(iso: string, tz: string, opts: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: tz, ...opts }).format(
    new Date(iso),
  );
}

export function fmtDateTime(iso: string, tz: string): string {
  return `${fmtDate(iso, tz)} ${fmtTime(iso, tz)}`;
}

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
  const start = zonedMidnight(dateYmd, tz);
  const end = new Date(start.getTime() + 24 * 3600 * 1000);
  return { from: start.toISOString(), to: end.toISOString() };
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

/** Inverse of toLocalInput: wall-clock in tz -> ISO instant. */
export function fromLocalInput(local: string, tz: string): string {
  const [datePart, timePart] = local.split("T");
  const [hh, mm] = (timePart ?? "00:00").split(":").map(Number);
  const midnight = zonedMidnight(datePart, tz);
  return new Date(midnight.getTime() + (hh * 60 + mm) * 60000).toISOString();
}

export function describePayload(payload: Record<string, unknown>): string {
  return Object.entries(payload)
    .filter(([, v]) => v !== null && v !== "" && v !== undefined)
    .map(([k, v]) => {
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
