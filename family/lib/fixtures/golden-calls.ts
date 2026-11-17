/**
 * The golden test's one door to the app's rules (lib/golden-baby.test.ts).
 *
 * One function for each pinned call. Each takes plain values and calls the library the way
 * the app calls it today; the comment on each names the screen or job it copies. When a
 * rule's signature changes, the new argument is added here and nowhere else: the test and
 * the stored results stay as they are. A function that works from a child or a log is
 * handed the child and the clock even where the library ignores them today (the entry
 * checks, the forecast), so a later argument is already at hand. The tables take an age
 * in days.
 *
 * Nothing here reads the wall clock: every "now" is given. Where the app calls a rule with
 * no "now" (it then takes the clock itself), the given instant is passed in its place.
 *
 * The helper's own files (its prompt, its snapshot, its tools) are loaded as they are,
 * through the resolve hook beside this file, and are handed a stand-in for the database
 * that answers from plain rows. Nothing of them is copied here.
 */
import { register } from "node:module";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EntryRow, Me } from "../types.ts";
import type { DayTotals } from "../norms.ts";
import type { GrowthKind } from "../who.ts";
import type { Key, Lang } from "../i18n.ts";
import type { SituationInput } from "../assistant/situation-format.ts";
import * as stage from "../stage.ts";
import * as norms from "../norms.ts";
import * as guide from "../child-guide.ts";
import * as checks from "../entry-checks.ts";
import * as insights from "../child-insights.ts";
import * as coming from "../forecast.ts";
import * as who from "../who.ts";
import * as names from "../names.ts";
import * as backlog from "../backlog.ts";
import * as i18n from "../i18n.ts";
import * as situation from "../assistant/situation-format.ts";
import * as quick from "../assistant/quick-log.ts";

// The helper's files import with "@/" and without ".ts"; plain node needs the hook for both.
register("./golden-resolve.mjs", import.meta.url);
const prompt = await import("../assistant/prompt.ts");
const snapshot = await import("../assistant/situation.ts");
const helper = await import("../assistant/tools.ts");

/** The child as the home holds them: a birth date (YYYY-MM-DD) or none, a name, the recorded sex. */
export interface Child {
  birthDate: string | null;
  name: string | null;
  sex: string | null;
}

/** One instant in one home: epoch ms, the home's calendar day (YYYY-MM-DD) and its time zone. */
export interface Clock {
  now: number;
  today: string;
  tz: string;
}

/**
 * The hour of an instant on the home's clock, as a fraction (19.5 is 19:30). The same reading
 * as Home's; the formatter is made once for a time zone and kept.
 */
const hourReaders = new Map<string, (iso: string) => number>();
function hourIn(tz: string): (iso: string) => number {
  let read = hourReaders.get(tz);
  if (!read) {
    const f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "numeric", minute: "numeric", hourCycle: "h23" });
    read = (iso) => {
      const p = f.formatToParts(new Date(iso));
      return Number(p.find((x) => x.type === "hour")?.value ?? 0) + Number(p.find((x) => x.type === "minute")?.value ?? 0) / 60;
    };
    hourReaders.set(tz, read);
  }
  return read;
}

// ---- the tables by age in days ------------------------------------------------------------

/** The stage for an age in days (the helper's prompt, lib/assistant/prompt.ts). */
export function stageOf(c: { ageDays: number }) {
  return stage.stageOf(c.ageDays);
}

/** The usual awake window for an age in days (the simple screen, the helper's sleep_rhythm). */
export function awakeWindow(c: { ageDays: number }) {
  return stage.awakeWindow(c.ageDays, null);
}

/** "12 days", "9 weeks", "5 months" (the child's header, Story, the Play page). */
export function ageLabel(c: { ageDays: number }) {
  return norms.ageLabel(c.ageDays);
}

/** When "last feed" turns yellow and red, from the stage for that age (as the guide works it out). */
export function feedLateMin(c: { ageDays: number }) {
  return stage.feedLateMin(stage.stageOf(c.ageDays));
}

/** The phases now and next (the "What this age brings" card). */
export function ageOutlook(c: { ageDays: number }) {
  return insights.ageOutlook(c.ageDays);
}

// ---- by child and clock ---------------------------------------------------------------------

/** The stage Home, the child's page and the strip use; 120 days when there is no birth date. */
export function stageFor(c: { child: Child; clock: Clock }) {
  return stage.stageFor(c.child.birthDate, c.clock.now, c.clock.tz);
}

/** The base gap for "next feed due": the entry type's own gap against the stage's (Home, the child's page). */
export function feedGapFor(c: { child: Child; clock: Clock; typeGapMin: number | null | undefined }) {
  return stage.feedGapFor(stage.stageFor(c.child.birthDate, c.clock.now, c.clock.tz), c.typeGapMin);
}

/** The nap count on the Sleep card, against the stage's usual naps (the child's page, Home). */
export function napsLine(c: { child: Child; clock: Clock; n: number; isToday: boolean }) {
  return stage.napsLine(c.n, stage.stageFor(c.child.birthDate, c.clock.now, c.clock.tz).naps, c.isToday);
}

/** Does pumping go on (Home's Pump row and pumping block). `lastPumpAt` is an ISO instant or null for never. */
export function pumpingActive(c: { child: Child; clock: Clock; lastPumpAt: string | null }) {
  return stage.pumpingActive(c.lastPumpAt, c.clock.now, stage.ageInDays(c.child.birthDate, c.clock.now, c.clock.tz));
}

/** The usual ranges on the Feeds card: none without a birth date (components/FeedDay.tsx). */
export function normsForAge(c: { child: Child; clock: Clock }) {
  return c.child.birthDate ? norms.normsForAge(norms.ageDays(c.child.birthDate, c.clock.today)) : null;
}

/**
 * A day's totals against the age (components/AgeCheck.tsx): no rows without a birth date;
 * the age is counted on `day`, the day the totals are for.
 */
export function checkDay(c: { child: Child; clock: Clock; totals: DayTotals; day: string; complete: boolean }) {
  return c.child.birthDate ? norms.checkDay(c.totals, norms.ageDays(c.child.birthDate, c.day), c.complete, { feed: true, diaper: true, sleep: true }) : null;
}

/**
 * The guide's tips (Home's one notice, the child's page, the helper's red_flag_check).
 * `feedGapMin` is the feed type's own gap, as those callers pass it.
 */
export function tipsFor(c: { child: Child; clock: Clock; entries: EntryRow[]; feedGapMin: number | undefined }) {
  return guide.tipsFor(c.entries, c.child.birthDate, c.clock.now, { timezone: c.clock.tz, feedGapMin: c.feedGapMin, name: c.child.name ?? undefined, sex: c.child.sex });
}

/** "When to call the doctor" for the child's age (both When to call pages); today's text with no birth date. */
export function topics(c: { child: Child; clock: Clock }) {
  return guide.topicsFor(c.child.birthDate ? norms.ageDays(c.child.birthDate, c.clock.today) : null);
}

/**
 * The entry checks (Home's count, the child's page, components/EntryChecks.tsx). Each flag is
 * returned without its `entry`, which is the input row itself; the flag's id names the row.
 */
export function checkEntries(c: { child: Child; clock: Clock; entries: EntryRow[] }) {
  return checks.checkEntries(c.entries, { now: c.clock.now, ageDays: c.child.birthDate ? norms.ageDays(c.child.birthDate, c.clock.today) : null }).map(({ entry: _row, ...flag }) => flag);
}

/** The sleep rhythm fold on the child's page; 120 days when there is no birth date. */
export function sleepCoach(c: { child: Child; clock: Clock; entries: EntryRow[] }) {
  return insights.sleepCoach(c.entries, c.child.birthDate ? norms.ageDays(c.child.birthDate, c.clock.today) : 120, hourIn(c.clock.tz), c.child.sex, null);
}

/** Home's nap card and the nap push: nothing without a birth date. */
export function nextNap(c: { child: Child; clock: Clock; entries: EntryRow[] }) {
  if (!c.child.birthDate) return null;
  const ageDays = norms.ageDays(c.child.birthDate, c.clock.today);
  // The pattern over Home's week (7 x 24 hours back from now), as Home asks it.
  return insights.nextNap(c.entries, ageDays, c.clock.now, hourIn(c.clock.tz), insights.napPattern(c.entries, ageDays, c.clock.now, c.clock.tz, c.clock.now - 7 * 86_400_000));
}

/**
 * The window drawn on Home's nap card (components/HomeState.tsx): from when the child woke
 * (`woke`, ISO) and when the next nap is due (`at`, epoch ms), as it stands at the clock.
 */
export function napWindow(c: { child: Child; clock: Clock; woke: string; at: number }) {
  return backlog.napWindow(Date.parse(c.woke), c.at, c.clock.now);
}

/** The breastfeeding parent's work hours: week days (0 is Sunday) and the hours as 900 and 1700. */
export interface WorkHours {
  days: number[];
  from: number;
  to: number;
}

/** Is a parent at work at an instant, worked out as Home and the child's page do. */
function awayOf(work: WorkHours | null, tz: string): (at: number) => boolean {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" });
  return (at) => {
    if (!work) return false;
    const parts = f.formatToParts(new Date(at));
    const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.find((p) => p.type === "weekday")?.value ?? "");
    const hm = Number(parts.find((p) => p.type === "hour")?.value ?? 0) * 100 + Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    return work.days.includes(wd) && hm >= work.from && hm <= work.to;
  };
}

/**
 * "Coming up" on the child's page: the next 12 hours from the week's entries, the feed gap
 * from the stage, and whether a parent is at work at an instant.
 */
export function forecast(c: { child: Child; clock: Clock; entries: EntryRow[]; typeGapMin: number | null | undefined; work: WorkHours | null }) {
  const feedIntervalMin = stage.feedGapFor(stage.stageFor(c.child.birthDate, c.clock.now, c.clock.tz), c.typeGapMin);
  return coming.forecast(c.entries, { now: c.clock.now, hours: 12, away: awayOf(c.work, c.clock.tz), feedIntervalMin });
}

/**
 * When the next feed is due and how full the last one was. With `awayCapMin` and work hours
 * it is Home's next bottle while a parent is away; with neither it is the guide's own call.
 * The last feed is returned by its id.
 */
export function nextFeedAt(c: { child: Child; clock: Clock; entries: EntryRow[]; gapMin: number; awayCapMin: number | null; work: WorkHours | null }) {
  const r = c.awayCapMin == null && !c.work ? coming.nextFeedAt(c.entries, { gapMin: c.gapMin }) : coming.nextFeedAt(c.entries, { gapMin: c.gapMin, awayCapMin: c.awayCapMin ?? undefined, away: awayOf(c.work, c.clock.tz) });
  return r ? { at: r.at, fullness: r.fullness, last: r.last.id } : null;
}

/** The hint under "Next feed" after a small feed (components/RightNow.tsx), with the child's pronoun. */
export function shortFeedHint(c: { child: Child; last: Pick<EntryRow, "payload" | "occurred_at" | "ended_at">; fullness: number }) {
  return coming.shortFeedHint(c.last, c.fullness, names.pronouns(c.child.sex).they);
}

// ---- names ------------------------------------------------------------------------------------

/** The pronouns for the child's recorded sex (every sentence the app writes about the child). */
export function pronouns(c: { child: Child }) {
  return names.pronouns(c.child.sex);
}

/** "Lana's", "James'" (the guide, the When to call pages). */
export function possessive(c: { name: string }) {
  return names.possessive(c.name);
}

// ---- growth -----------------------------------------------------------------------------------

/** The three reference values at an age (Story, the growth chart), for the child's recorded sex. */
export function reference(c: { kind: GrowthKind; ageDays: number; sex: string | null }) {
  return who.reference(c.kind, c.ageDays, c.sex);
}

/** Roughly which percentile a measurement sits on (the growth chart). */
export function percentileOf(c: { kind: GrowthKind; ageDays: number; value: number; sex: string | null }) {
  return who.percentileOf(c.kind, c.ageDays, c.value, c.sex);
}

/** "about the 40th percentile" (the growth chart). */
export function percentileLabel(c: { p: number }) {
  return who.percentileLabel(c.p);
}

// ---- the simple screen ------------------------------------------------------------------------

/** One line of the simple screen in the member's language (components/SimpleHome.tsx): the child's name and sex are filled in. */
export function simpleLine(c: { child: Child; lang: Lang; key: Key }) {
  return i18n.t(c.lang, c.key, { child: c.child.name ?? "the baby", sex: c.child.sex });
}

/** "2 h 10 min ago" in the member's language (the simple screen's last feed and last diaper). */
export function fmtAgo(c: { lang: Lang; minutes: number }) {
  return i18n.fmtAgo(c.lang, c.minutes);
}

// ---- the helper: the pure parts -----------------------------------------------------------------

/** The helper's snapshot in words, from values already worked out; the pronoun comes from the child's sex. */
export function formatSituation(c: { child: Child; clock: Clock; input: SituationInput }) {
  return situation.formatSituation({ ...c.input, them: names.pronouns(c.child.sex).them });
}

/** The helper's line on the milk at home. */
export function formatMilk(c: { milk: { fridge_ml: number; fridge_count: number; freezer_ml: number; freezer_count: number } | null }) {
  return situation.formatMilk(c.milk);
}

/** The free reader for typed and spoken logs (components/Assistant.tsx). `nowLocal` is the home's "YYYY-MM-DDTHH:MM". */
export function readQuick(c: { child: Child; message: string; nowLocal: string; diaperKinds: string[]; milks: string[] }) {
  return quick.readQuick(c.message, c.nowLocal, { name: (c.child.name ?? "").split(" ")[0], diaperKinds: c.diaperKinds, milks: c.milks });
}

/** The answer to the reader's one question, "Wet, dirty or both?". */
export function readDiaperAnswer(c: { message: string; diaperKinds: string[] }) {
  return quick.readDiaperAnswer(c.message, c.diaperKinds);
}

// ---- the helper: its own files, as they are -----------------------------------------------------

/**
 * One home as the database holds it, in plain rows and answers: everything the helper reads
 * before it speaks. The child is one row of `tables.care_subjects`.
 */
export interface Home {
  /** me(): the member asking, the role and what it may do, the household. */
  me: Me;
  /** The rows of the tables the helper lists itself: care_subjects, care_entry_types, members, roles. */
  tables: Record<string, unknown[]>;
  /** The answer of each database function the helper calls, by its name ("home_summary", "care_daily_stats", ...). */
  answers: Record<string, unknown>;
  /** The child's entries, newest first. care_entries_list answers from these, cut to the window asked for. */
  entries: EntryRow[];
}

/** A stand-in for the database client: it answers from the home's rows and nothing else. */
function clientOf(home: Home): SupabaseClient {
  const answer = (data: unknown) => {
    const p = Promise.resolve({ data, error: null });
    return Object.assign(p, { abortSignal: () => p });
  };
  const from = (table: string) => {
    const q = {
      select: () => q,
      eq: () => q,
      order: () => q,
      then: <T>(done: (v: { data: unknown[]; error: null }) => T) => Promise.resolve({ data: home.tables[table] ?? [], error: null }).then(done),
    };
    return q;
  };
  const rpc = (name: string, args: Record<string, unknown> = {}) => {
    if (name !== "care_entries_list") return answer(home.answers[name] ?? null);
    // As the database cuts it: from p_from up to, not including, p_to.
    const lo = Date.parse(String(args.p_from));
    const hi = Date.parse(String(args.p_to));
    return answer({ ok: true, entries: home.entries.filter((e) => Date.parse(e.occurred_at) >= lo && Date.parse(e.occurred_at) < hi) });
  };
  return { from, rpc } as unknown as SupabaseClient;
}

/** What the helper knows of the home before a question, loaded by its own loadContext. */
function contextOf(c: { clock: Clock; home: Home; screen?: string | null }) {
  return helper.loadContext(clientOf(c.home), c.home.me, new Date(c.clock.now), { screen: c.screen ?? null });
}

/** The helper's snapshot, by its own loader (lib/assistant/situation.ts): the child, last night, the usual day, the milk, who is home. */
export async function helperSituation(c: { child: Child; clock: Clock; home: Home }) {
  return snapshot.loadSituation(await contextOf(c));
}

/** The phase line of that snapshot ("Phase: ..."), or null when the snapshot has none. */
export async function situationPhase(c: { child: Child; clock: Clock; home: Home }) {
  const text = await snapshot.loadSituation(await contextOf(c));
  return text.split("\n").find((line) => line.startsWith("Phase:")) ?? null;
}

/**
 * What the helper is told with every question (volatileSystem in lib/assistant/prompt.ts): the
 * time, the child's age and what is usual now, who is asking, and the snapshot given.
 */
export async function helperNow(c: { child: Child; clock: Clock; home: Home; screen: string | null; situation: string }) {
  return prompt.volatileSystem({ ...(await contextOf(c)), situation: c.situation });
}

/** The helper's standing instructions for the home (stableSystem in lib/assistant/prompt.ts). */
export async function helperStable(c: { child: Child; clock: Clock; home: Home }) {
  return prompt.stableSystem(await contextOf(c));
}

/** One of the helper's own tools, built and run as the helper runs it. */
async function runTool(c: { clock: Clock; home: Home }, name: string, input: Record<string, unknown>) {
  const ctx = await contextOf(c);
  const tool = helper.buildTools(ctx).find((t) => t.def.name === name);
  if (!tool) throw new Error(`the helper has no tool called ${name} for this member`);
  return tool.run(input, ctx);
}

/** The helper's day_schedule: a day's rhythm from a wake time ("HH:MM"), from the child's last 14 days of sleep. */
export function daySchedule(c: { child: Child; clock: Clock; home: Home; wakeTime: string }) {
  return runTool(c, "day_schedule", { wake_time: c.wakeTime });
}

/** The helper's sleep_rhythm: the sleep coach's reading of the last 14 days and the usual awake window. */
export function sleepRhythm(c: { child: Child; clock: Clock; home: Home }) {
  return runTool(c, "sleep_rhythm", {});
}

/** The helper's red_flag_check over the last `days` days: the guide's red and yellow tips, and any temperature of 38 or more. */
export function redFlagCheck(c: { child: Child; clock: Clock; home: Home; days: number }) {
  return runTool(c, "red_flag_check", { days: c.days });
}

/** The helper's age_outlook: the phases now and next, and the week by week stretch. */
export function ageOutlookTool(c: { child: Child; clock: Clock; home: Home }) {
  return runTool(c, "age_outlook", {});
}

/** The helper's due_soon: what the database lists as due, less the feed's own interval row. */
export function dueSoon(c: { child: Child; clock: Clock; home: Home; daysAhead: number }) {
  return runTool(c, "due_soon", { days_ahead: c.daysAhead });
}
