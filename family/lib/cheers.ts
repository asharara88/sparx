/**
 * A cheer: one short line from one member of a home to another, about something that member
 * did (DESIGN.md, "Cheers and shared nights"; migration 7000). The words here are the ones a
 * tap sends; anyone may write their own instead. They thank and they notice. None of them
 * measures, compares or asks for more.
 *
 * Pure: no "@/" imports, so the unit tests run it as it is.
 */
import { tierOf } from "./achievements.ts";
import { addDays, fmtTime } from "./time.ts";

/** One tap sends one of these. */
export const CHEER_WORDS = ["Thank you", "Proud of you", "You are doing so much"] as const;
/** Offered for a night, once the sender has the child: the cheer that says the load is lifted. */
export const CHEER_REST = "Rest, I have the morning";
/** The longest a cheer may be (the database refuses more). */
export const CHEER_MAX = 80;

export type CheerAbout = "log" | "day" | "medal" | "night";

/** A cheer as achievements_check() hands it to its receiver. */
export interface Cheer {
  id: string;
  from_name: string;
  about: CheerAbout;
  ref_day: string | null;
  words: string;
  sent_at: string;
  badge?: string | null;
  tier?: number | null;
  type_label?: string | null;
  occurred_at?: string | null;
}

const weekday = (ymd: string) => new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" }).format(new Date(`${ymd}T12:00:00Z`));

/** What a cheer is for, in a few words after "for": "last night", "today", "Tuesday", "the Bronze medal", "the feed at 03:10". */
export function cheerFor(c: Pick<Cheer, "about" | "ref_day" | "badge" | "tier" | "type_label" | "occurred_at">, today: string, tz: string): string {
  if (c.about === "night") return c.ref_day && c.ref_day !== addDays(today, -1) ? `${weekday(c.ref_day)} night` : "last night";
  if (c.about === "day") return !c.ref_day || c.ref_day === today ? "today" : c.ref_day === addDays(today, -1) ? "yesterday" : weekday(c.ref_day);
  if (c.about === "medal") {
    const t = c.badge && c.tier != null ? tierOf(c.badge, c.tier) : null;
    return t ? `the ${t.name} medal` : "a medal";
  }
  const what = (c.type_label ?? "entry").toLowerCase();
  return c.occurred_at ? `the ${what} at ${fmtTime(c.occurred_at, tz)}` : `the ${what}`;
}
