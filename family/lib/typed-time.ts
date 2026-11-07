/**
 * A time typed by hand ("2130", "21:30", "21.30", "930", "9pm", "9:30 pm") turned into a
 * local "YYYY-MM-DDTHH:MM" in the household's clock. Mido, 7 November: picking from fixed
 * buttons was too limiting. Pure: works on local strings only (the caller converts with
 * lib/time), so the unit tests load it on its own.
 */

export function parseClock(text: string): { h: number; m: number } | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, "");
  if (!t) return null;
  const pm = /p\.?m?\.?$/.test(t) && /\d/.test(t);
  const am = /a\.?m?\.?$/.test(t) && /\d/.test(t);
  const core = t.replace(/[ap]\.?m?\.?$/, "");
  let h: number;
  let m: number;
  const sep = core.match(/^(\d{1,2})[:.h](\d{1,2})$/);
  if (sep) {
    h = Number(sep[1]);
    m = Number(sep[2]);
  } else if (/^\d{3,4}$/.test(core)) {
    h = Number(core.slice(0, core.length - 2));
    m = Number(core.slice(-2));
  } else if (/^\d{1,2}$/.test(core)) {
    h = Number(core);
    m = 0;
  } else return null;
  if (pm || am) {
    if (h < 1 || h > 12) return null;
    if (pm && h < 12) h += 12;
    if (am && h === 12) h = 0;
  }
  if (h > 23 || m > 59) return null;
  return { h, m };
}

const pad = (n: number) => String(n).padStart(2, "0");
function shiftDay(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The local time a typed clock means. With `day`, on that day (`yesterday` takes the day
 * before). Without, the most recent such time up to now: 21:30 typed at 02:00 is last night.
 */
export function resolveTyped(text: string, nowLocal: string, opts: { day?: string | null; yesterday?: boolean } = {}): string | null {
  const c = parseClock(text);
  if (!c) return null;
  const hhmm = `${pad(c.h)}:${pad(c.m)}`;
  if (opts.day) return `${opts.yesterday ? shiftDay(opts.day, -1) : opts.day}T${hhmm}`;
  const today = nowLocal.slice(0, 10);
  let day = `${today}T${hhmm}` > nowLocal.slice(0, 16) ? shiftDay(today, -1) : today;
  if (opts.yesterday && day === today) day = shiftDay(today, -1);
  return `${day}T${hhmm}`;
}

/** "today 21:30", "yesterday 21:30", "5 Nov 21:30" for a resolved local time. */
export function dayWord(local: string, nowLocal: string): string {
  const day = local.slice(0, 10);
  const today = nowLocal.slice(0, 10);
  const when = day === today ? "today" : day === shiftDay(today, -1) ? "yesterday" : `${Number(day.slice(8, 10))} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(day.slice(5, 7)) - 1]}`;
  return `${when} ${local.slice(11, 16)}`;
}
