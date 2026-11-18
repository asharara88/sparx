/**
 * What a family logs, and so what Home may count (R8). From 12 months a family may not log
 * milk feeds or diapers at all (a cup at breakfast, a potty), and a zero for a kind nobody
 * logs reads as a warning: so a toddler's screens show a kind only when it was logged
 * lately. A baby's screens are as they always were. Pure: no "@/" imports, so the unit tests
 * load it on its own.
 */
import { addDays, dateWords, fmtTime, ymdInZone } from "./time.ts";
import { isToddler, range, type Stage } from "./stage.ts";
import { normsForAge } from "./norms.ts";

/**
 * Logged lately: an entry on the home's `today` or on one of the 6 calendar days before it,
 * on the home's calendar (`tz`). `lastAt` is the newest entry of that kind (ISO), as
 * home_summary's `last` gives it, or null for never.
 */
export function loggedLately(lastAt: string | null | undefined, today: string, tz: string): boolean {
  if (!lastAt) return false;
  const at = Date.parse(lastAt);
  if (!Number.isFinite(at)) return false;
  const day = ymdInZone(new Date(at), tz);
  return day >= addDays(today, -6) && day <= today;
}

/** The kinds (type ids, "lana.feed") with an entry logged lately, from a list of entries. */
export function kindsLoggedLately(entries: readonly { type_id: string; occurred_at: string }[], today: string, tz: string): Set<string> {
  const out = new Set<string>();
  for (const e of entries) if (!out.has(e.type_id) && loggedLately(e.occurred_at, today, tz)) out.add(e.type_id);
  return out;
}

/** One cell of Home's strip: the number, and the word under it. */
export interface StripCell {
  value: string;
  label: string;
}

/**
 * Home's strip (components/TodayStrip.tsx): when the child woke, naps, feeds and diapers so
 * far today. A baby always gets the four cells. A toddler gets "woke"; the naps while a nap is
 * expected (napPattern) or one was had today; feeds and diapers only when that kind was
 * logged lately. With fewer than two cells there is no strip: null.
 *
 * Naps read "1 of 1–2" while the usual range starts at 1 or more, and a plain count when it
 * starts at 0 ("1" over "nap", "2" over "naps").
 */
export function stripCells(c: {
  stage: Pick<Stage, "toddler" | "naps">;
  /** When the child woke this morning ("06:45"), or "—". */
  woke: string;
  /** Naps so far today (lib/sleep-day). */
  naps: number;
  /** napPattern(...).expected; not read for a baby. */
  napExpected: boolean;
  /** Today's counts (home_summary's today_counts). */
  feeds: number;
  diapers: number;
  /** The newest feed and diaper, any day (home_summary's last), ISO or null. */
  lastFeedAt: string | null;
  lastDiaperAt: string | null;
  today: string;
  tz: string;
}): StripCell[] | null {
  const usual = c.stage.naps;
  const naps: StripCell = usual[0] > 0 ? { value: `${c.naps} of ${range(usual)}`, label: "naps" } : usual[1] ? { value: `${c.naps}`, label: c.stage.toddler && c.naps === 1 ? "nap" : "naps" } : { value: `${c.naps}`, label: "naps" };
  const feeds: StripCell = { value: `${c.feeds}`, label: c.feeds === 1 ? "feed" : "feeds" };
  const diapers: StripCell = { value: `${c.diapers}`, label: c.diapers === 1 ? "diaper" : "diapers" };
  const woke: StripCell = { value: c.woke, label: "woke" };
  if (!c.stage.toddler) return [woke, naps, feeds, diapers];
  const cells = [woke];
  if (c.napExpected || c.naps > 0) cells.push(naps);
  if (loggedLately(c.lastFeedAt, c.today, c.tz)) cells.push(feeds);
  if (loggedLately(c.lastDiaperAt, c.today, c.tz)) cells.push(diapers);
  return cells.length >= 2 ? cells : null;
}

/** The Feeds card (components/FeedDay.tsx) in words. */
export interface FeedCardText {
  /** Drawn at all: always for a baby; for a toddler only when a milk feed was logged lately. */
  show: boolean;
  /** The big line. */
  headline: string;
  /** The line under it. */
  line: string;
  /** "Usual at this age: 6 to 8 feeds a day." for a baby with a birth date; null otherwise. */
  usual: string | null;
}

/**
 * The Feeds card, on Home and on the Feeds section. A baby's as it has always been: the
 * next feed ("Feed due now", "Next feed about 15:10"), what went in today, the usual number.
 * A toddler's milk has no clock and no usual number: "Feeding now" while a feed runs; fed
 * today, the day's sum ("180 ml in 1 bottle", "2 breastfeeds") over "Last at 18:40."; none
 * today, "None today" over "Last: yesterday 18:40.". Never "yet", "due" or "usual".
 */
export function feedCard(c: {
  /** The child's age in days on the home's calendar; null with no birth date. */
  ageDays: number | null;
  /** A feed timer is running. */
  feeding: boolean;
  /** home_summary's next_due for the feed (a baby's only), ISO or null. */
  nextDue: string | null;
  /** Today's feed entries. */
  todayFeeds: readonly { payload: Record<string, unknown> }[];
  /** The newest feed, any day (home_summary's last), ISO or null. */
  lastFeedAt: string | null;
  today: string;
  tz: string;
  now: number;
}): FeedCardText {
  const bottles = c.todayFeeds.filter((e) => e.payload.method === "Bottle");
  const ml = bottles.reduce((a, e) => a + (Number(e.payload.amount_ml) || 0), 0);
  const breast = c.todayFeeds.length - bottles.length;
  const parts = [bottles.length ? `${ml ? `${ml} ml in ` : ""}${bottles.length} ${bottles.length === 1 ? "bottle" : "bottles"}` : null, breast ? `${breast} ${breast === 1 ? "breastfeed" : "breastfeeds"}` : null].filter(Boolean).join(" · ");
  if (!isToddler(c.ageDays)) {
    const due = c.nextDue;
    const norms = c.ageDays == null ? null : normsForAge(c.ageDays).feeds;
    return {
      show: true,
      headline: c.feeding ? "Feeding now" : due ? (Date.parse(due) <= c.now ? "Feed due now" : `Next feed about ${fmtTime(due, c.tz)}`) : "No feed logged yet",
      line: parts || "Nothing yet today.",
      usual: norms ? `Usual at this age: ${norms.low} to ${norms.high} feeds a day.` : null,
    };
  }
  const show = loggedLately(c.lastFeedAt, c.today, c.tz);
  if (c.feeding) return { show, headline: "Feeding now", line: parts, usual: null };
  if (parts && c.lastFeedAt) return { show, headline: parts, line: `Last at ${fmtTime(c.lastFeedAt, c.tz)}.`, usual: null };
  return { show, headline: "None today", line: c.lastFeedAt ? `Last: ${dayWord(c.lastFeedAt, c.today, c.tz)} ${fmtTime(c.lastFeedAt, c.tz)}.` : "", usual: null };
}

/** "yesterday", or the weekday ("Saturday") for an earlier day of the week. */
function dayWord(iso: string, today: string, tz: string): string {
  return ymdInZone(new Date(iso), tz) === addDays(today, -1) ? "yesterday" : dateWords(new Date(iso), { weekday: "long", timeZone: tz });
}

/**
 * The Food card's headline (components/FoodDay.tsx): the meals today, and for a baby on
 * solids what is usual ("usually 1–2 a day"). From 12 months the count alone ("4 meals"):
 * a snack logged as a meal is not a fourth meal against three.
 */
export function foodHeadline(stage: Pick<Stage, "toddler" | "meals">, mealsToday: number): { count: string; usual: string | null } {
  return {
    count: mealsToday ? `${mealsToday} meal${mealsToday === 1 ? "" : "s"}` : "No meal yet",
    usual: !stage.toddler && stage.meals ? `usually ${range(stage.meals)} a day` : null,
  };
}
