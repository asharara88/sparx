/**
 * Home's strip and the Feeds card with a saved day (lib/logged.ts stripCells' `plan` and
 * feedCard's `day`). Without the new key both must answer exactly as they did before it
 * existed: the two functions are kept below as they stood on main, and held against the
 * new ones over a grid of ages and days. What a toddler's home sees with no day is in
 * lib/toddler.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { feedCard, loggedLately, stripCells, type FeedCardText, type StripCell } from "./logged.ts";
import { dayPlan, type DayFacts, type SavedDay } from "./day.ts";
import { isToddler, range, stageOf } from "./stage.ts";
import { normsForAge } from "./norms.ts";
import { addDays, dateWords, fmtTime, ymdInZone } from "./time.ts";
import { at, iso, msOf, TODAY, TZ } from "./fixtures/toddler-days.ts";

type StripIn = Parameters<typeof stripCells>[0];
type CardIn = Parameters<typeof feedCard>[0];

/** What a cell says. Each cell also names its kind since 24 November (Home's strip links naps and
 *  feeds by it; lib/toddler.test.ts checks the kinds); what the strip says is held to main here. */
type Said = Pick<StripCell, "value" | "label">;
const said = (cells: StripCell[] | null): Said[] | null => cells?.map(({ value, label }) => ({ value, label })) ?? null;
/** stripCells as it stood on main. */
function stripOnMain(c: StripIn): Said[] | null {
  const usual = c.stage.naps;
  const naps: Said = usual[0] > 0 ? { value: `${c.naps} of ${range(usual)}`, label: "naps" } : usual[1] ? { value: `${c.naps}`, label: c.stage.toddler && c.naps === 1 ? "nap" : "naps" } : { value: `${c.naps}`, label: "naps" };
  const feeds: Said = { value: `${c.feeds}`, label: c.feeds === 1 ? "feed" : "feeds" };
  const diapers: Said = { value: `${c.diapers}`, label: c.diapers === 1 ? "diaper" : "diapers" };
  const woke: Said = { value: c.woke, label: "woke" };
  if (!c.stage.toddler) return [woke, naps, feeds, diapers];
  const cells = [woke];
  if (c.napExpected || c.naps > 0) cells.push(naps);
  if (loggedLately(c.lastFeedAt, c.today, c.tz)) cells.push(feeds);
  if (loggedLately(c.lastDiaperAt, c.today, c.tz)) cells.push(diapers);
  return cells.length >= 2 ? cells : null;
}

/** feedCard as it stood on main. */
function cardOnMain(c: CardIn): FeedCardText {
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
function dayWord(iso: string, today: string, tz: string): string {
  return ymdInZone(new Date(iso), tz) === addDays(today, -1) ? "yesterday" : dateWords(new Date(iso), { weekday: "long", timeZone: tz });
}

const AGES = [0, 41, 120, 167, 168, 250, 365, 366, 380, 547, 548, 563, 730, 731, 746, 1095, 1096, 1111];
const LASTS = [null, iso(at(0, "07:00")), iso(at(-1, "18:40")), iso(at(-3, "18:40")), iso(at(-6, "00:00")), iso(at(-7, "18:40"))];
/** Never, this morning, 6 days ago (still lately) and 7 days ago (no longer). */
const EDGES = [null, iso(at(0, "07:00")), iso(at(-6, "00:00")), iso(at(-7, "18:40"))];
const NOW = msOf(at(0, "13:00"));

// ---- the strip ------------------------------------------------------------------------------------

test("stripCells without a plan, with a plan that names no cells, and for a baby with any plan: as on main", () => {
  let n = 0;
  for (const age of AGES) for (const naps of [0, 1, 2, 3]) for (const napExpected of [true, false]) for (const [feeds, diapers] of [[0, 0], [1, 1], [4, 6]]) for (const lastFeedAt of EDGES) for (const lastDiaperAt of EDGES) {
    const c: StripIn = { stage: stageOf(age), woke: naps ? "06:45" : "—", naps, napExpected, feeds, diapers, lastFeedAt, lastDiaperAt, today: TODAY, tz: TZ };
    const was = stripOnMain(c);
    const got = said(stripCells(c));
    const where = `day ${age} naps ${naps} ${napExpected} ${feeds} ${diapers} ${lastFeedAt} ${lastDiaperAt}`;
    assert.deepEqual(got, was, where);
    assert.equal(JSON.stringify(got), JSON.stringify(was), where);
    // Usual naps with no cells named is not a day: it is not read.
    assert.deepEqual(said(stripCells({ ...c, plan: { cells: null, usualNaps: n % 2 ? [2, 2] : null, meals: 3, potty: 2 } })), was, where);
    if (n % 7 === 0) assert.deepEqual(said(stripCells({ ...c, plan: undefined })), was, where);
    if (!isToddler(age)) assert.deepEqual(said(stripCells({ ...c, plan: { cells: ["woke", "meals"], usualNaps: [0, 1], meals: 3, potty: 2 } })), was, where);
    n++;
  }
  assert.equal(n, AGES.length * 4 * 2 * 3 * 4 * 4);
});

const strip = (over: Partial<StripIn>, plan: Partial<NonNullable<StripIn["plan"]>>) =>
  stripCells({ stage: stageOf(600), woke: "07:00", naps: 0, napExpected: true, feeds: 0, diapers: 0, lastFeedAt: null, lastDiaperAt: null, today: TODAY, tz: TZ, ...over, plan: { cells: ["woke", "naps"], usualNaps: [1, 1], meals: 0, potty: 0, ...plan } })?.map((c) => `${c.value} ${c.label}`) ?? null;

test("stripCells with a day: the cells the day names, each with its number", () => {
  assert.deepEqual(strip({ naps: 1, diapers: 2 }, { cells: ["woke", "naps", "diapers", "meals"], meals: 3 }), ["07:00 woke", "1 of 1 naps", "2 diapers", "3 meals"]);
  assert.deepEqual(strip({ feeds: 1, diapers: 1 }, { cells: ["woke", "naps", "feeds", "diapers"] }), ["07:00 woke", "0 of 1 naps", "1 feed", "1 diaper"]);
  assert.deepEqual(strip({}, { cells: ["woke", "potty", "meals"], potty: 2, meals: 1 }), ["07:00 woke", "2 potty", "1 meal"]);
  assert.deepEqual(strip({}, { cells: ["woke", "potty", "meals"], potty: 1, meals: 0 }), ["07:00 woke", "1 potty", "0 meals"]);
  // The cells are the day's: nothing here is asked of the log again.
  assert.deepEqual(strip({ lastFeedAt: iso(at(0, "07:00")), lastDiaperAt: iso(at(0, "07:05")), feeds: 2, diapers: 3 }, { cells: ["woke", "meals"], meals: 2 }), ["07:00 woke", "2 meals"]);
  assert.deepEqual(strip({ napExpected: false }, { cells: ["woke", "naps"] }), ["07:00 woke", "0 of 1 naps"]);
});

test("stripCells with a day: the naps against the family's answer, not the age's range", () => {
  const naps = (n: number, usualNaps: [number, number], age = 400) => strip({ stage: stageOf(age), naps: n }, { usualNaps })?.[1];
  assert.deepEqual([naps(0, [2, 2]), naps(1, [2, 2]), naps(2, [2, 2])], ["0 of 2 naps", "1 of 2 naps", "2 of 2 naps"]);
  assert.deepEqual([naps(0, [1, 1]), naps(1, [1, 1])], ["0 of 1 naps", "1 of 1 naps"]);
  // "None" is [0, 1]: a plain count for the nap that was had all the same, never "of" or "yet".
  assert.deepEqual([naps(1, [0, 1]), naps(2, [0, 1])], ["1 nap", "2 naps"]);
  // At 12 months the age says 1–2; a family that says one sees "of 1".
  assert.equal(stripCells({ stage: stageOf(400), woke: "07:00", naps: 1, napExpected: true, feeds: 0, diapers: 0, lastFeedAt: null, lastDiaperAt: null, today: TODAY, tz: TZ })?.[1].value, "1 of 1–2");
  assert.equal(naps(1, [1, 1]), "1 of 1 naps");
});

test("stripCells with a day: fewer than two cells is no strip", () => {
  assert.equal(strip({}, { cells: ["woke"] }), null);
  assert.equal(strip({}, { cells: [] }), null);
  assert.deepEqual(strip({}, { cells: ["woke", "meals"] }), ["07:00 woke", "0 meals"]);
});

// ---- the Feeds card -------------------------------------------------------------------------------

const b180 = { payload: { method: "Bottle", amount_ml: 180 } };
const FEEDS: CardIn["todayFeeds"][] = [[], [b180], [{ payload: { method: "Breast" } }, { payload: { method: "Breast" } }], [b180, { payload: { method: "Breast" } }], [{ payload: { method: "Bottle" } }]];

test("feedCard without a day, with a null day, and for a baby with any day: as on main", () => {
  let n = 0;
  for (const ageDays of [null, ...AGES]) for (const feeding of [true, false]) for (const nextDue of [null, iso(at(0, "10:00")), iso(at(0, "15:10"))]) for (const todayFeeds of FEEDS) for (const lastFeedAt of LASTS) {
    const c: CardIn = { ageDays, feeding, nextDue, todayFeeds, lastFeedAt, today: TODAY, tz: TZ, now: NOW };
    const was = cardOnMain(c);
    const where = `day ${ageDays} ${JSON.stringify(c)}`;
    assert.deepEqual(feedCard(c), was, where);
    assert.equal(JSON.stringify(feedCard(c)), JSON.stringify(was), where);
    assert.deepEqual(feedCard({ ...c, day: null }), was, where);
    assert.deepEqual(feedCard({ ...c, day: undefined }), was, where);
    if (!isToddler(ageDays)) for (const day of [{ show: false, clock: false }, { show: true, clock: true }, { show: false, clock: true }]) assert.deepEqual(feedCard({ ...c, day }), was, where);
    n++;
  }
  assert.equal(n, (AGES.length + 1) * 2 * 3 * FEEDS.length * LASTS.length);
});

const card = (over: Partial<CardIn>) => feedCard({ ageDays: 380, feeding: false, nextDue: null, todayFeeds: [], lastFeedAt: iso(at(0, "07:00")), today: TODAY, tz: TZ, now: NOW, ...over });
const CLOCK = { show: true, clock: true };

test("the clock toddler's card: the next feed, as a baby's, and no usual number", () => {
  const cases = [
    card({ day: CLOCK, nextDue: iso(at(0, "12:00")), todayFeeds: [b180] }),
    card({ day: CLOCK, nextDue: iso(at(0, "15:10")), todayFeeds: [b180, { payload: { method: "Breast" } }] }),
    card({ day: CLOCK, nextDue: iso(at(0, "12:00")), todayFeeds: [], lastFeedAt: iso(at(-1, "19:00")) }),
    card({ day: CLOCK, nextDue: iso(at(0, "15:10")), feeding: true, todayFeeds: [{ payload: { method: "Breast" } }] }),
  ];
  assert.deepEqual(cases.map((c) => [c.show, c.headline, c.line, c.usual]), [
    [true, "Feed due now", "180 ml in 1 bottle", null],
    [true, "Next feed about 15:10", "180 ml in 1 bottle · 1 breastfeed", null],
    [true, "Feed due now", "Nothing yet today.", null],
    [true, "Feeding now", "1 breastfeed", null],
  ]);
  // The same headline a baby of 6 months gets from the same day.
  const baby = card({ ageDays: 180, nextDue: iso(at(0, "15:10")), todayFeeds: [b180] });
  const toddler = card({ day: CLOCK, nextDue: iso(at(0, "15:10")), todayFeeds: [b180] });
  assert.deepEqual([toddler.headline, toddler.line], [baby.headline, baby.line]);
  assert.ok(baby.usual && toddler.usual === null);
  // No due time to go by (an older database answers none for a toddler): the day's sum, never "No feed logged yet".
  assert.deepEqual(card({ day: CLOCK, todayFeeds: [b180] }), { show: true, headline: "180 ml in 1 bottle", line: "Last at 07:00.", usual: null });
  assert.deepEqual(card({ day: CLOCK, lastFeedAt: iso(at(-1, "18:40")) }), { show: true, headline: "None today", line: "Last: yesterday 18:40.", usual: null });
});

test("the Feeds card with a day: drawn when the day says so; a drink has no due time", () => {
  const drink = { show: true, clock: false };
  const fed = card({ day: drink, nextDue: iso(at(0, "12:00")), todayFeeds: [b180] });
  assert.deepEqual(fed, { show: true, headline: "180 ml in 1 bottle", line: "Last at 07:00.", usual: null });
  assert.deepEqual(fed, card({ nextDue: iso(at(0, "12:00")), todayFeeds: [b180] }), "the toddler's card of before");
  for (const todayFeeds of FEEDS) for (const feeding of [true, false]) {
    const c = card({ day: drink, nextDue: iso(at(0, "12:00")), todayFeeds, feeding });
    assert.ok(!/\b(yet|due|usual)\b/i.test(`${c.headline} ${c.line}`) && c.usual === null, c.headline);
  }
  // Milk not logged by the day's word: no card, even with a bottle this morning.
  assert.equal(card({ day: { show: false, clock: false }, todayFeeds: [b180] }).show, false);
  assert.equal(card({ todayFeeds: [b180] }).show, true);
});

test("the plan's own answers through both: a clock home fed today, and the same home a week on", () => {
  const facts = (over: Partial<DayFacts>): DayFacts => ({ now: NOW, today: TODAY, tz: TZ, has: { meal: true, pump: false, potty: false }, breastfeeds: false, lastPumpAt: null, inStock: false, lastFeedAt: null, lastDiaperAt: null, lastMealAt: null, lastPottyAt: null, breastLately: false, napExpected: true, napsToday: 1, ...over });
  const saved: SavedDay = { v: 1, milk: "clock", naps: 2, diapers: "diapers", stores_milk: false };
  const read = (f: DayFacts) => {
    const plan = dayPlan(saved, 380, f);
    const cells = stripCells({ stage: stageOf(380), woke: "06:45", naps: f.napsToday, napExpected: f.napExpected, feeds: 1, diapers: 2, lastFeedAt: f.lastFeedAt, lastDiaperAt: f.lastDiaperAt, today: TODAY, tz: TZ, plan: { cells: plan.cells, usualNaps: plan.usualNaps, meals: 2, potty: 0 } });
    const fedToday = f.lastFeedAt === iso(at(0, "07:00"));
    const feeds = feedCard({ ageDays: 380, feeding: false, nextDue: iso(at(fedToday ? 0 : -8, "12:00")), todayFeeds: fedToday ? [b180] : [], lastFeedAt: f.lastFeedAt, today: TODAY, tz: TZ, now: NOW, day: plan.feedCard });
    return { strip: cells?.map((c) => `${c.value} ${c.label}`).join(" · ") ?? "no strip", show: feeds.show, headline: feeds.headline };
  };
  // (home_summary gives a clock home's feed a next_due however old the feed is; the plan is what keeps it quiet.)
  assert.deepEqual(read(facts({ lastFeedAt: iso(at(0, "07:00")), lastDiaperAt: iso(at(0, "07:05")), lastMealAt: iso(at(0, "07:45")) })), { strip: "06:45 woke · 1 of 2 naps · 1 feed · 2 diapers", show: true, headline: "Feed due now" });
  // Milk last logged 8 days ago: no feeds cell, no card, and so no "Feed due now" from last week.
  const later = read(facts({ lastFeedAt: iso(at(-8, "19:00")), lastDiaperAt: iso(at(0, "07:05")), lastMealAt: iso(at(0, "07:45")) }));
  assert.deepEqual(later, { strip: "06:45 woke · 1 of 2 naps · 2 diapers · 2 meals", show: false, headline: "None today" });
});
