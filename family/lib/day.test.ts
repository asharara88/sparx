/**
 * "{Name}'s day" (lib/day.ts). Two promises are held here. With no day, and for every baby
 * whatever is stored, the plan is what the app computed before the day existed: those
 * expressions are kept below as they stood on main, and the plan is held against them. With
 * a day, each answer gives the rows, cells, tiles and notices the tables below spell out.
 * The clock and the four families are the toddler tests' (lib/fixtures/toddler-days.ts).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { bandOf, dayFacts, dayOffer, dayPlan, homeRows, loggedDays, milkTab, pottyCount, readDay, suggestDay, typesForDay, typesOn, type DayFacts, type SavedDay } from "./day.ts";
import { defaultNaps, pumpingActive, stageOf } from "./stage.ts";
import { loggedLately } from "./logged.ts";
import { napPattern } from "./child-insights.ts";
import { at, bornAgo, DAY, FAMILIES, familyLog, iso, MIN, msOf, readAt, TODAY, TZ, ymd, type Family } from "./fixtures/toddler-days.ts";

const NOW = msOf(at(0, "13:00"));
const facts = (over: Partial<DayFacts> = {}): DayFacts => ({
  now: NOW, today: TODAY, tz: TZ, has: { meal: true, pump: true, potty: false }, breastfeeds: false, lastPumpAt: null, inStock: false,
  lastFeedAt: null, lastDiaperAt: null, lastMealAt: null, lastPottyAt: null, breastLately: false, napExpected: true, napsToday: 0, ...over,
});
/** Everything logged this morning, by a mother who breastfeeds and pumps, in a home with the Potty type. */
const BUSY = facts({ has: { meal: true, pump: true, potty: true }, breastfeeds: true, lastPumpAt: iso(at(0, "06:00")), inStock: true, lastFeedAt: iso(at(0, "07:00")), lastDiaperAt: iso(at(0, "07:05")), lastMealAt: iso(at(0, "07:45")), lastPottyAt: iso(at(0, "08:00")), breastLately: true, napsToday: 1 });

const MILKS = ["clock", "drink", "off"] as const;
const DIAPERS = ["diapers", "both", "potty", "off"] as const;
/** The 72 days a family can save. */
const DAYS: SavedDay[] = MILKS.flatMap((milk) => ([0, 1, 2] as const).flatMap((naps) => DIAPERS.flatMap((diapers) => [true, false].map((stores_milk): SavedDay => ({ v: 1, milk, naps, diapers, stores_milk })))));
const day = (over: Partial<SavedDay> = {}): SavedDay => ({ v: 1, milk: "drink", naps: 1, diapers: "diapers", stores_milk: false, ...over });

/** settings.day as subject_day_save writes it. */
const stored = (over: Record<string, unknown> = {}) => ({ v: 1, milk: "drink", naps: 1, diapers: "diapers", stores_milk: false, saved_on: TODAY, saved_at: "2026-11-17T08:12:00Z", saved_by: "m1", ...over });
const settings = (d: unknown, more: Record<string, unknown> = {}) => ({ night_from: "19:30", night_to: "06:30", day: d, ...more });

// ---- the bands ---------------------------------------------------------------------------------

test("the bands turn on days 366, 548, 731 and 1096, the days the stage's band turns", () => {
  assert.deepEqual([0, 365, 366, 547, 548, 730, 731, 1095, 1096, 2000].map(bandOf), [null, null, 12, 12, 18, 18, 24, 24, 36, 36]);
  assert.equal(bandOf(null), null);
  for (let d = 1; d <= 1200; d++) assert.equal(bandOf(d) !== bandOf(d - 1), stageOf(d).band !== stageOf(d - 1).band && d >= 366, `day ${d}`);
});

// ---- readDay: when a stored day counts ----------------------------------------------------------

test("readDay: no day under 12 months, with no birth date, or for a day that does not read whole", () => {
  // A baby, whatever is stored and whenever it says it was saved.
  for (let age = 0; age <= 365; age++) for (const on of [TODAY, "2099-01-01"]) assert.equal(readDay(settings(stored({ saved_on: on })), age, bornAgo(age)), null, `day ${age}`);
  assert.deepEqual(readDay(settings(stored()), 400, bornAgo(400)), { v: 1, milk: "drink", naps: 1, diapers: "diapers", stores_milk: false }, "only the checked answers come back");
  assert.equal(readDay(settings(stored()), 400, null), null, "no birth date");
  assert.equal(readDay(settings(stored()), null, null), null);
  assert.equal(readDay(settings(stored()), 400, "not a date"), null);
  const bad: unknown[] = [
    stored({ v: 2 }), stored({ v: true }), stored({ v: undefined }),
    stored({ milk: "x" }), stored({ milk: undefined }), stored({ milk: null }),
    stored({ naps: 3 }), stored({ naps: 1.5 }), stored({ naps: 99999999999 }), stored({ naps: "1" }), stored({ naps: null }), stored({ naps: undefined }),
    stored({ diapers: "nappy" }), stored({ diapers: undefined }),
    stored({ stores_milk: "yes" }), stored({ stores_milk: 1 }), stored({ stores_milk: undefined }),
    [stored()], "drink", null, undefined, 1,
  ];
  for (const d of bad) assert.equal(readDay(settings(d), 400, bornAgo(400)), null, JSON.stringify(d));
  for (const s of [null, undefined, "x", 3, {}, { night_from: "19:00" }]) assert.equal(readDay(s, 400, bornAgo(400)), null, JSON.stringify(s));
  // The database compares the version as text, so the text "1" counts there and here.
  assert.equal(readDay(settings(stored({ v: "1" })), 400, bornAgo(400))?.v, 1);
  for (const d of DAYS) assert.deepEqual(readDay(settings({ ...d, saved_on: TODAY }), 600, bornAgo(600)), d);
});

test("readDay: an answer counts only if the child had reached 12 months on the day it was given", () => {
  const born = bornAgo(400);
  const first = ymd(-34); // day 366 by this birth date
  assert.deepEqual([ymd(-35), first, TODAY].map((on) => !!readDay(settings(stored({ saved_on: on })), 400, born)), [false, true, true]);
  for (const on of [undefined, null, 20261117, "17 Nov 2026", "2026-11-1", "2026-11-17T08:12:00Z", ""]) assert.equal(readDay(settings(stored({ saved_on: on })), 400, born), null, String(on));
  // A year mistyped at sign-up: saved 300 days ago, when the app took the child for a toddler.
  // The birth date was corrected since; by it the child is 400 days old today and was 100 then.
  assert.equal(readDay(settings(stored({ saved_on: ymd(-300) })), 400, born), null);
  // A birth date with a time on it is read by its date.
  assert.ok(readDay(settings(stored()), 400, `${born}T00:00:00Z`));
});

test("readDay: both and potty read as diapers under 18 months", () => {
  const diapersAt = (age: number, diapers: string) => readDay(settings(stored({ diapers })), age, bornAgo(age))?.diapers;
  assert.deepEqual([diapersAt(547, "potty"), diapersAt(547, "both"), diapersAt(547, "off"), diapersAt(548, "potty"), diapersAt(548, "both")], ["diapers", "diapers", "off", "potty", "both"]);
});

// ---- a baby, and a home with no day --------------------------------------------------------------

test("a baby's plan is the plan with no day, at every age to 365 and for each of the 72 days", () => {
  const sets = [facts(), BUSY, facts({ has: { meal: false, pump: false, potty: true }, breastfeeds: true, lastPumpAt: iso(at(-20, "09:00")), napExpected: false })];
  for (const f of sets) {
    for (const age of [null, ...Array.from({ length: 366 }, (_, i) => i)]) {
      const none = dayPlan(null, age, f);
      assert.equal(none.saved, false);
      for (const d of DAYS) {
        assert.deepEqual(dayPlan(d, age, f), none, `day ${age} ${JSON.stringify(d)}`);
        assert.deepEqual(homeRows(d, age, f), none.rows);
      }
    }
  }
});

/**
 * What main computes with no day, as it stands there: app/(app)/page.tsx 119, 145 to 150,
 * 178 to 179 and 187 (with components/FridgePlan.tsx:13), and components/LanaNow.tsx 358 to
 * 359. `age` is the page's (null with no birth date); the stage is stageFor's, which takes a
 * child with no birth date as 120 days old.
 */
function main(age: number | null, f: DayFacts) {
  const stage = stageOf(age ?? 120);
  const milkClock = stage ? stage.milkClock : true;
  const inStock = f.inStock;
  const pumping = pumpingActive(f.lastPumpAt, f.now, age);
  const milkStored = !stage?.toddler || inStock || pumping;
  const lately = (lastAt: string | null) => !stage?.toddler || loggedLately(lastAt, f.today, f.tz);
  const handoverKinds = { feeds: lately(f.lastFeedAt), diapers: lately(f.lastDiaperAt), naps: !stage?.toddler || f.napExpected || f.napsToday > 0 };
  const fourth: "meal" | "pump" | "meds" = stage.solids && f.has.meal ? "meal" : f.breastfeeds && f.has.pump && pumpingActive(f.lastPumpAt, f.now, age) ? "pump" : "meds";
  // The fridge plan while the away parent is out: main draws it for any home, and the card itself returns nothing without a milk clock.
  return { milkClock, milkStored, handoverKinds, rows: ["feed", "sleep", "diaper", fourth], fridgePlan: milkClock };
}

test("the plan with no day is what main computes: rows, stored milk, the notices, the fridge plan, the handover tiles", () => {
  const AGES = [0, 167, 168, 365, 366, 547, 548, 730, 731, 1095, 1096, null];
  const pumps = [null, iso(at(0, "06:00")), iso(at(-13, "13:30")), iso(at(-15, "09:00"))];
  const lasts = [null, iso(at(0, "07:00")), iso(at(-6, "00:00")), iso(at(-7, "23:59"))];
  let n = 0;
  const hold = (age: number | null, f: DayFacts) => {
    const was = main(age, f);
    const plan = dayPlan(null, age, f);
    const where = () => `day ${age} ${JSON.stringify(f)}`;
    try {
      assert.deepEqual(plan.rows, was.rows);
      assert.deepEqual(homeRows(null, age, f), was.rows);
      assert.deepEqual([plan.milkClock, plan.storesMilk, plan.milkNotices], [was.milkClock, was.milkStored, was.milkStored]);
      assert.equal(plan.milkNotices && plan.milkClock, was.fridgePlan);
      assert.deepEqual(plan.kinds, was.handoverKinds);
    } catch (e) {
      throw new Error(`${where()}: ${(e as Error).message}`);
    }
    n++;
  };
  // Who breastfeeds, pumps and stock, and the types the home has: the rows and stored milk.
  for (const age of AGES) for (const breastfeeds of [true, false]) for (const lastPumpAt of pumps) for (const inStock of [true, false]) for (const meal of [true, false]) for (const pump of [true, false]) {
    hold(age, facts({ breastfeeds, lastPumpAt, inStock, has: { meal, pump, potty: false } }));
    hold(age, { ...BUSY, breastfeeds, lastPumpAt, inStock, has: { meal, pump, potty: true } });
  }
  // What was logged lately and the naps: the handover tiles.
  for (const age of AGES) for (const lastFeedAt of lasts) for (const lastDiaperAt of lasts) for (const [napExpected, napsToday] of [[true, 0], [false, 0], [false, 1]] as const) {
    hold(age, facts({ lastFeedAt, lastDiaperAt, napExpected, napsToday }));
    hold(age, facts({ lastFeedAt, lastDiaperAt, napExpected, napsToday, breastfeeds: true, inStock: true, lastPumpAt: pumps[1] }));
  }
  assert.equal(n, 12 * 2 * 4 * 2 * 2 * 2 * 2 + 12 * 4 * 4 * 3 * 2);
});

test("the plan with no day leaves the strip, the tiles and the Feeds card to their own rules, and turns nothing on", () => {
  for (const age of [null, 0, 365, 366, 1096]) {
    const p = dayPlan(null, age, BUSY);
    assert.deepEqual([p.saved, p.milk, p.diapers, p.cells, p.tiles, p.feedCard, p.napsSaid, p.usualNaps], [false, null, null, null, null, null, null, null], `day ${age}`);
    assert.deepEqual(p.on, { potty: false, extras: false, pump: true });
  }
  // A toddler's home with no day: no milk clock; stored milk only with stock or a pump in 14 days.
  assert.deepEqual([366, 1096].map((age) => dayPlan(null, age, facts()).storesMilk), [false, false]);
  assert.deepEqual([facts({ inStock: true }), facts({ lastPumpAt: iso(at(-13, "13:30")) }), facts({ lastPumpAt: iso(at(-15, "09:00")) })].map((f) => dayPlan(null, 400, f).milkNotices), [true, true, false]);
});

// ---- a saved day: the tables -------------------------------------------------------------------

const AGE = 600; // 18 months and over, so potty can be on

test("a saved day: Home's rows for each milk and diapers answer; a slot not used takes Medicine, then Note", () => {
  const rows: Record<string, string> = {
    "clock diapers": "meal sleep diaper feed", "clock both": "meal sleep diaper_potty feed", "clock potty": "meal sleep potty feed", "clock off": "meal sleep meds feed",
    "drink diapers": "meal sleep diaper milk", "drink both": "meal sleep diaper_potty milk", "drink potty": "meal sleep potty milk", "drink off": "meal sleep meds milk",
    "off diapers": "meal sleep diaper meds", "off both": "meal sleep diaper_potty meds", "off potty": "meal sleep potty meds", "off off": "meal sleep meds note",
  };
  for (const milk of MILKS) for (const diapers of DIAPERS) {
    for (const f of [BUSY, facts({ has: { meal: true, pump: false, potty: true } })]) {
      assert.equal(homeRows(day({ milk, diapers }), AGE, f).join(" "), rows[`${milk} ${diapers}`], `${milk} ${diapers}`);
      assert.equal(dayPlan(day({ milk, diapers }), AGE, f).rows.join(" "), rows[`${milk} ${diapers}`]);
    }
  }
  // Rows follow the answers, never the log, the naps or the stash.
  for (const d of DAYS) assert.deepEqual(homeRows(d, AGE, BUSY), homeRows({ ...d, naps: 1, stores_milk: true }, AGE, facts({ has: BUSY.has })));
  // No Meal type in the home: the first slot is not used either, and the fillers go in slot order.
  const noMeal = facts({ has: { meal: false, pump: true, potty: true } });
  assert.equal(homeRows(day({ milk: "drink", diapers: "diapers" }), AGE, noMeal).join(" "), "meds sleep diaper milk");
  assert.equal(homeRows(day({ milk: "clock", diapers: "off" }), AGE, noMeal).join(" "), "meds sleep note feed");
  assert.equal(homeRows(day({ milk: "off", diapers: "off" }), AGE, noMeal).join(" "), "meds sleep note", "two fillers only");
  // Note fills a slot only where the Note type is on: a row that opens nothing is worse than a row fewer.
  const noNote = facts({ has: { meal: true, pump: true, potty: false, note: false } });
  assert.equal(homeRows(day({ milk: "off", diapers: "off" }), AGE, noNote).join(" "), "meal sleep meds", "Note is switched off: no Note row");
  assert.equal(homeRows(day({ milk: "drink", diapers: "off" }), AGE, noNote).join(" "), "meal sleep meds milk", "Medicine still fills the one free slot");
  assert.equal(homeRows(day({ milk: "off", diapers: "off" }), AGE, facts({ has: { meal: true, pump: true, potty: false, note: true } })).join(" "), "meal sleep meds note");
  assert.deepEqual(homeRows(null, AGE, noNote), homeRows(null, AGE, facts()), "with no day the Note type changes nothing");
  // The Pump row is a baby's fourth row: a toddler's day never brings it back.
  for (const d of DAYS) assert.ok(!homeRows(d, AGE, BUSY).includes("pump"));
});

test("a saved day: the strip's cells, four at most, and no feeds cell for a drink", () => {
  const cells: Record<string, string> = {
    "clock diapers": "woke naps feeds diapers", "clock both": "woke naps feeds diapers", "clock potty": "woke naps feeds potty", "clock off": "woke naps feeds meals",
    "drink diapers": "woke naps diapers meals", "drink both": "woke naps diapers potty", "drink potty": "woke naps potty meals", "drink off": "woke naps meals",
    "off diapers": "woke naps diapers meals", "off both": "woke naps diapers potty", "off potty": "woke naps potty meals", "off off": "woke naps meals",
  };
  for (const milk of MILKS) for (const diapers of DIAPERS) assert.equal(dayPlan(day({ milk, diapers }), AGE, BUSY).cells?.join(" "), cells[`${milk} ${diapers}`], `${milk} ${diapers}`);
  for (const d of DAYS) assert.ok(dayPlan(d, AGE, BUSY).cells!.length <= 4);
  // Naps: the answer, or one had today.
  const quiet = { ...BUSY, napsToday: 0 };
  assert.deepEqual([dayPlan(day({ naps: 0 }), AGE, quiet).cells, dayPlan(day({ naps: 0 }), AGE, BUSY).cells, dayPlan(day({ naps: 2 }), AGE, quiet).cells], [["woke", "diapers", "meals"], ["woke", "naps", "diapers", "meals"], ["woke", "naps", "diapers", "meals"]]);
  // One cell is not a strip: stripCells answers null for it.
  assert.deepEqual(dayPlan(day({ milk: "off", naps: 0, diapers: "off" }), AGE, facts()).cells, ["woke"]);
});

test("a saved day: the child's tiles, four at most", () => {
  const tiles: Record<string, string> = {
    "clock diapers": "sleep breastfeeds bottles diapers", "clock both": "sleep breastfeeds bottles diapers", "clock potty": "sleep breastfeeds bottles potty", "clock off": "sleep breastfeeds bottles meals",
    "drink diapers": "sleep milk diapers meals", "drink both": "sleep milk diapers potty", "drink potty": "sleep milk potty meals", "drink off": "sleep milk meals",
    "off diapers": "sleep diapers meals", "off both": "sleep diapers potty meals", "off potty": "sleep potty meals", "off off": "sleep meals",
  };
  for (const milk of MILKS) for (const diapers of DIAPERS) assert.equal(dayPlan(day({ milk, diapers }), AGE, BUSY).tiles?.join(" "), tiles[`${milk} ${diapers}`], `${milk} ${diapers}`);
  // The breastfeeds tile only where a breastfeed was logged lately.
  assert.equal(dayPlan(day({ milk: "clock" }), AGE, { ...BUSY, breastLately: false }).tiles?.join(" "), "sleep bottles diapers meals");
  assert.deepEqual(dayPlan(day({ milk: "off", diapers: "off" }), AGE, facts()).tiles, ["sleep"]);
});

test("a saved day: the handover tiles, the Feeds card, the naps and what is turned on", () => {
  for (const d of DAYS) {
    const p = dayPlan(d, AGE, BUSY);
    assert.deepEqual([p.saved, p.milk, p.diapers, p.napsSaid], [true, d.milk, d.diapers, d.naps]);
    assert.deepEqual(p.kinds, { feeds: d.milk !== "off", diapers: d.diapers === "diapers" || d.diapers === "both", naps: true }, JSON.stringify(d));
    assert.deepEqual(p.feedCard, { show: d.milk !== "off", clock: d.milk === "clock" });
    assert.equal(p.milkClock, d.milk === "clock");
    assert.deepEqual(p.usualNaps, d.naps === 0 ? [0, 1] : [d.naps, d.naps]);
    assert.deepEqual(p.on, { potty: d.diapers === "both" || d.diapers === "potty", extras: true, pump: d.stores_milk });
    assert.deepEqual([p.storesMilk, p.milkNotices], [d.stores_milk, d.stores_milk]);
  }
  // No nap said and none had: no naps tile for "since Mama left".
  assert.equal(dayPlan(day({ naps: 0 }), AGE, facts()).kinds.naps, false);
  assert.equal(dayPlan(day({ naps: 0 }), AGE, facts({ napsToday: 1 })).kinds.naps, true);
});

test("potty stays off under 18 months and in a home without the Potty type", () => {
  const noType = { ...BUSY, has: { meal: true, pump: true, potty: false } };
  for (const diapers of ["both", "potty"] as const) {
    for (const [age, f] of [[547, BUSY], [AGE, noType]] as const) {
      const p = dayPlan(day({ diapers }), age, f);
      assert.equal(p.on.potty, false, `${diapers} ${age}`);
      assert.equal(p.diapers, "diapers");
      assert.equal(p.rows.join(" "), "meal sleep diaper milk");
      assert.ok(!p.cells!.includes("potty") && !p.tiles!.includes("potty") && p.cells!.includes("diapers") && p.kinds.diapers);
      assert.deepEqual(typesOn([{ id: "lana.potty", settings: { needs: "potty" } }], p.on), []);
    }
    assert.equal(dayPlan(day({ diapers }), 548, BUSY).on.potty, true);
  }
});

test("a count needs its kind logged lately: saving the suggested day brings back no zero", () => {
  // A drink and diapers, the answers by age, in a home that has logged neither.
  const p = dayPlan(day({ milk: "drink", diapers: "diapers" }), 380, facts({ lastMealAt: iso(at(0, "07:45")) }));
  assert.deepEqual(p.cells, ["woke", "naps", "meals"], "no feeds or diapers cell");
  assert.deepEqual(p.feedCard, { show: false, clock: false }, "no Milk card");
  assert.deepEqual(p.kinds, { feeds: false, diapers: false, naps: true }, "no handover tile");
  assert.deepEqual(p.tiles, ["sleep", "meals"]);
  assert.equal(p.rows.join(" "), "meal sleep diaper milk", "the rows follow the answers all the same");
  // Logged 7 days ago is not lately; 6 days ago is.
  const old = facts({ lastFeedAt: iso(at(-7, "23:59")), lastDiaperAt: iso(at(-7, "23:59")), lastMealAt: iso(at(-7, "23:59")), lastPottyAt: iso(at(-7, "23:59")), has: BUSY.has });
  assert.deepEqual(dayPlan(day({ diapers: "both" }), AGE, old).cells, ["woke", "naps"]);
  const week = facts({ lastFeedAt: iso(at(-6, "00:00")), lastDiaperAt: iso(at(-6, "00:00")), lastMealAt: iso(at(-6, "00:00")), lastPottyAt: iso(at(-6, "00:00")), has: BUSY.has });
  assert.deepEqual(dayPlan(day({ diapers: "both" }), AGE, week).tiles, ["sleep", "milk", "diapers", "potty"]);
  // An answer turns a kind on, the log alone does not: milk and diapers not logged by the day's word.
  assert.deepEqual(dayPlan(day({ milk: "off", diapers: "off" }), AGE, BUSY).kinds, { feeds: false, diapers: false, naps: true });
});

test("stored milk: the answer keeps the tab; the notices stop 14 days after the last pump with nothing in stock", () => {
  const yes = day({ stores_milk: true });
  const quiet = dayPlan(yes, 400, facts({ lastPumpAt: iso(at(-15, "09:00")) }));
  assert.deepEqual([quiet.storesMilk, quiet.milkNotices, quiet.on.pump], [true, false, true]);
  assert.equal(dayPlan(yes, 400, facts()).milkNotices, false, "never pumped, nothing in stock");
  assert.equal(dayPlan(yes, 400, facts({ lastPumpAt: iso(at(-13, "13:30")) })).milkNotices, true);
  assert.equal(dayPlan(yes, 400, facts({ inStock: true })).milkNotices, true);
  // The answer no: no notice and no Pump, whatever an older build put in the stash.
  const no = dayPlan(day({ stores_milk: false }), 400, facts({ inStock: true, lastPumpAt: iso(at(0, "06:00")) }));
  assert.deepEqual([no.storesMilk, no.milkNotices, no.on.pump], [false, false, false]);
});

test("the clock needs a feed logged lately: no 'Feed due now' from last week", () => {
  const clock = day({ milk: "clock", stores_milk: true });
  const stale = dayPlan(clock, 400, facts({ lastFeedAt: iso(at(-8, "19:00")), inStock: true }));
  assert.deepEqual([stale.milkClock, stale.feedCard, stale.kinds.feeds], [false, { show: false, clock: false }, false]);
  assert.ok(!stale.cells!.includes("feeds") && !stale.tiles!.includes("bottles"));
  assert.equal(stale.rows[3], "feed", "the row stays: it is how the next feed is logged");
  const fed = dayPlan(clock, 400, facts({ lastFeedAt: iso(at(0, "07:00")), inStock: true }));
  assert.deepEqual([fed.milkClock, fed.feedCard, fed.kinds.feeds], [true, { show: true, clock: true }, true]);
  assert.ok(fed.cells!.includes("feeds") && fed.tiles!.includes("bottles"));
  // A drink logged lately has its card and its tile, and still no clock.
  const drink = dayPlan(day({ milk: "drink" }), 400, facts({ lastFeedAt: iso(at(0, "07:00")) }));
  assert.deepEqual([drink.milkClock, drink.feedCard], [false, { show: true, clock: false }]);
});

test("a home on the clock that stores no milk gets no fridge plan", () => {
  // Home draws the plan card on `milkNotices`, and the card itself needs `milkClock`.
  const fed = { lastFeedAt: iso(at(0, "07:00")) };
  const drawn = (p: { milkNotices: boolean; milkClock: boolean }) => p.milkNotices && p.milkClock;
  assert.equal(drawn(dayPlan(day({ milk: "clock", stores_milk: false }), 400, facts(fed))), false);
  assert.equal(drawn(dayPlan(day({ milk: "clock", stores_milk: false }), 400, facts({ ...fed, inStock: true }))), false);
  assert.equal(drawn(dayPlan(day({ milk: "clock", stores_milk: true }), 400, facts({ ...fed, inStock: true }))), true);
  assert.equal(drawn(dayPlan(day({ milk: "drink", stores_milk: true }), 400, facts({ ...fed, inStock: true }))), false);
});

// ---- the answers the screen opens on -------------------------------------------------------------

const noLog = (age: number) => napPattern([], age, NOW, TZ, NOW - 7 * DAY * MIN);

/** A family's week as the day screen reads it at 13:00: the facts, the nap pattern and the days with entries. */
function weekOf(fam: Family) {
  const week = readAt(familyLog(fam), at(0, "13:00"));
  const last = (kind: string) => week.find((e) => e.type_id === `lana.${kind}`)?.occurred_at ?? null;
  const pattern = napPattern(week, fam.ageDays, NOW, TZ, NOW - 7 * DAY * MIN);
  return { week, pattern, logged: loggedDays(week, TODAY, TZ), f: facts({ lastFeedAt: last("feed"), lastDiaperAt: last("diaper"), lastMealAt: last("meal"), lastPottyAt: last("potty"), lastPumpAt: last("pump"), napExpected: pattern.expected, napsToday: pattern.napsToday }) };
}

test("suggestDay with no log: a start for the age, never the clock, never potty", () => {
  const byAge = (age: number) => suggestDay(age, facts(), noLog(age), null, 0);
  assert.deepEqual(byAge(380), { milk: "drink", naps: 2, diapers: "diapers", stores_milk: false, from: "age" });
  assert.deepEqual(byAge(563), { milk: "drink", naps: 1, diapers: "diapers", stores_milk: false, from: "age" });
  assert.deepEqual(byAge(746), { milk: "drink", naps: 1, diapers: "diapers", stores_milk: false, from: "age" });
  assert.deepEqual(byAge(1111), { milk: "drink", naps: 0, diapers: "off", stores_milk: false, from: "age" });
  assert.deepEqual([456, 457].map((age) => byAge(age).naps), [2, 1], "one nap from 15 months");
  // The naps by age are the naps Home expects with nothing logged.
  for (const age of [366, 456, 457, 547, 548, 730, 731, 1095, 1096]) assert.equal(byAge(age).naps, noLog(age).expected ? Math.min(2, defaultNaps(age)) : 0, `day ${age}`);
  // Two days with entries are not a log; the same start. A bottle in stock is stored milk: the screen does not ask then.
  assert.deepEqual(suggestDay(380, facts({ lastFeedAt: iso(at(0, "07:00")) }), noLog(380), null, 2).from, "age");
  assert.equal(suggestDay(380, facts({ inStock: true }), noLog(380), null, 0).stores_milk, true);
  assert.equal(suggestDay(380, facts({ lastPumpAt: iso(at(-1, "09:00")) }), noLog(380), null, 0).stores_milk, false);
});

test("suggestDay from the four families' weeks: what each logs", () => {
  const from = (fam: Family, saved: SavedDay | null = null) => {
    const w = weekOf(fam);
    assert.ok(w.logged >= 3, fam.name);
    return suggestDay(fam.ageDays, w.f, w.pattern, saved, w.logged);
  };
  assert.deepEqual(from(FAMILIES.noor), { milk: "drink", naps: 2, diapers: "diapers", stores_milk: false, from: "log" });
  assert.deepEqual(from(FAMILIES.adam), { milk: "off", naps: 1, diapers: "diapers", stores_milk: false, from: "log" });
  assert.deepEqual(from(FAMILIES.maya), { milk: "off", naps: 1, diapers: "diapers", stores_milk: false, from: "log" });
  assert.deepEqual(from(FAMILIES.yusuf), { milk: "off", naps: 0, diapers: "off", stores_milk: false, from: "log" });
  // From an offer with a day saved: the clock a family chose stays while milk is logged, a
  // stale nap answer is corrected, and stored milk said yes is never set to no.
  assert.deepEqual(from(FAMILIES.noor, day({ milk: "clock", naps: 1, diapers: "off", stores_milk: true })), { milk: "clock", naps: 2, diapers: "diapers", stores_milk: true, from: "log" });
  assert.deepEqual(from(FAMILIES.adam, day({ milk: "clock", naps: 2 })), { milk: "off", naps: 1, diapers: "diapers", stores_milk: false, from: "log" });
  // From About the child the saved day is shown as it is, whatever the week says.
  const w = weekOf(FAMILIES.noor);
  assert.deepEqual(suggestDay(380, w.f, w.pattern, day({ milk: "off", naps: 0, diapers: "off" }), null), { milk: "off", naps: 0, diapers: "off", stores_milk: false, from: "saved" });
  // Stored milk from the log: a pump in 14 days or a bottle in stock.
  assert.equal(suggestDay(380, { ...w.f, lastPumpAt: iso(at(-13, "13:30")) }, w.pattern, null, w.logged).stores_milk, true);
  assert.equal(suggestDay(380, { ...w.f, lastPumpAt: iso(at(-15, "09:00")) }, w.pattern, null, w.logged).stores_milk, false);
  assert.equal(suggestDay(380, { ...w.f, inStock: true }, w.pattern, null, w.logged).stores_milk, true);
});

test("suggestDay: a saved day comes back when the week is empty; the log never fills potty in unless logged", () => {
  const saved = day({ milk: "clock", naps: 0, diapers: "potty", stores_milk: false });
  const has = { meal: true, pump: true, potty: true };
  assert.deepEqual(suggestDay(1111, facts({ has }), noLog(1111), saved, 0), { milk: "clock", naps: 0, diapers: "potty", stores_milk: false, from: "saved" });
  assert.deepEqual(suggestDay(1111, facts({ has }), noLog(1111), saved, null), { milk: "clock", naps: 0, diapers: "potty", stores_milk: false, from: "saved" });
  // Potty and diapers by what was logged, from 18 months.
  const pattern = noLog(600);
  const logged = (f: Partial<DayFacts>) => suggestDay(600, facts({ has, ...f }), pattern, null, 5).diapers;
  const today = iso(at(0, "08:00"));
  assert.deepEqual([logged({ lastDiaperAt: today, lastPottyAt: today }), logged({ lastPottyAt: today }), logged({ lastDiaperAt: today }), logged({})], ["both", "potty", "diapers", "off"]);
  assert.equal(suggestDay(400, facts({ has, lastDiaperAt: today, lastPottyAt: today }), noLog(400), null, 5).diapers, "diapers", "not under 18 months");
  // A family that said no nap and logs meals but no sleep keeps its answer: the log says nothing about naps.
  const meals = facts({ lastMealAt: today });
  assert.equal(suggestDay(800, meals, noLog(800), day({ naps: 0 }), 5).naps, 0);
  assert.equal(suggestDay(800, meals, noLog(800), null, 5).naps, 1, "with no day the pattern's start for the age");
  // A pattern built from the family's own answer is not the log speaking.
  const w = weekOf(FAMILIES.noor);
  const said = napPattern(w.week, 380, NOW, TZ, NOW - 7 * DAY * MIN, 0);
  assert.equal(suggestDay(380, w.f, said, day({ naps: 1 }), w.logged).naps, 1);
});

test("loggedDays: the days with an entry among today and the six before, on the home's calendar", () => {
  const e = (d: number, hhmm: string) => ({ occurred_at: iso(at(d, hhmm)) });
  assert.equal(loggedDays([], TODAY, TZ), 0);
  assert.equal(loggedDays([e(0, "00:00"), e(0, "12:00"), e(-1, "23:59"), e(-6, "00:00"), e(-7, "23:59"), e(1, "00:00"), { occurred_at: "x" }], TODAY, TZ), 3);
  assert.equal(loggedDays([e(-6, "00:00")], TODAY, "UTC"), 0, "the same instant is 10 November in UTC");
  assert.equal(weekOf(FAMILIES.yusuf).logged, 7);
});

// ---- the offer at 12, 18, 24 and 36 months --------------------------------------------------------

const LONG_AGO = "2024-01-01T08:00:00Z";
const offer = (age: number, over: Partial<Parameters<typeof dayOffer>[0]> = {}) => dayOffer({ settings: {}, birthDate: bornAgo(age), createdAt: LONG_AGO, today: TODAY, tz: TZ, name: "Lana", their: "her", ...over });

test("dayOffer: from day 366, 548, 731 and 1096, in the child's own words", () => {
  assert.equal(offer(365), null);
  assert.deepEqual(offer(366), { band: 12, words: "Lana is one. Look at her day", early: true });
  assert.equal(offer(547), null);
  assert.deepEqual(offer(548, { name: "Adam", their: "his" }), { band: 18, words: "Adam is 18 months. Look at his day", early: true });
  assert.equal(offer(730), null);
  assert.deepEqual(offer(731, { name: "Maya" }), { band: 24, words: "Maya is two. Look at her day", early: true });
  assert.equal(offer(1095), null);
  assert.deepEqual(offer(1096, { name: "Yusuf", their: "his" }), { band: 36, words: "Yusuf is three. Look at his day", early: true });
  assert.equal(offer(120), null);
  assert.equal(offer(400, { birthDate: null }), null, "no birth date");
  assert.equal(offer(400, { birthDate: "soon" }), null);
});

test("dayOffer: early for 7 days, shown for 30, then it ends by itself", () => {
  assert.deepEqual([366, 372, 373, 395].map((age) => offer(age)?.early), [true, true, false, false]);
  assert.equal(offer(396), null, "day 31");
  assert.deepEqual([548 + 6, 548 + 7, 548 + 29].map((age) => offer(age)?.early), [true, false, false]);
  assert.equal(offer(548 + 30), null);
});

test("dayOffer: a family that joined after the band began sets the day up, for 30 days from joining", () => {
  const joined = (age: number, daysAgo: number, hhmm = "09:00") => offer(age, { name: "Noor", createdAt: iso(at(-daysAgo, hhmm)) });
  assert.deepEqual(joined(380, 0), { band: 12, words: "Set up Noor's day", early: true });
  assert.deepEqual(joined(380, 14), { band: 12, words: "Set up Noor's day", early: false }, "joined on the band's first day");
  // At 500 days the band began 134 days ago: the 30 days run from the day the family joined.
  assert.deepEqual([joined(500, 6)?.early, joined(500, 7)?.early, joined(500, 29)?.early], [true, false, false]);
  assert.equal(joined(500, 30), null);
  assert.equal(joined(1111, 3)?.words, "Set up Noor's day");
  assert.equal(offer(380, { name: "James", createdAt: iso(at(0, "09:00")) })?.words, "Set up James' day");
  // The day the row was made is the home's: 01:00 in Dubai is still the day before in UTC.
  assert.equal(joined(500, 29, "01:00")?.early, false);
  assert.equal(joined(500, 30, "23:59"), null);
  // Joined before the band began: the birthday line, counted from the band's first day.
  assert.deepEqual(joined(370, 10), { band: 12, words: "Noor is one. Look at her day", early: true });
  // The next band comes in the birthday's words: the family was here when it began.
  assert.equal(joined(548, 100)?.words, "Noor is 18 months. Look at her day");
  // A row with no date on it (an older session): counted from the band's first day.
  assert.deepEqual(offer(370, { createdAt: null }), { band: 12, words: "Lana is one. Look at her day", early: true });
  assert.equal(offer(400, { createdAt: "x" }), null);
});

test("dayOffer: settled by Save or 'Keep it as it is', but only by an answer given at that age", () => {
  // Day 370; the band began 4 days ago.
  const asked = (settings: Record<string, unknown>, age = 370) => offer(age, { settings });
  assert.equal(asked({ day_asked: 12, day_asked_on: ymd(-2) }), null);
  assert.equal(asked({ day_asked: 12, day_asked_on: ymd(-4) }), null, "on the band's first day");
  assert.ok(asked({ day_asked: 12, day_asked_on: ymd(-5) }), "the day before the band began: read as not asked");
  assert.ok(asked({ day_asked: 12 }), "no date: not asked");
  assert.ok(asked({ day_asked: 12, day_asked_on: 20261115 }));
  assert.ok(asked({ day_asked: "12", day_asked_on: ymd(-2) }));
  assert.ok(asked({ day_asked: 13, day_asked_on: ymd(-2) }));
  // A day saved at 12 months still brings the 18-month line; one settled at 18 does not.
  assert.equal(asked({ day_asked: 12, day_asked_on: ymd(-180) }, 550)?.band, 18);
  assert.equal(asked({ day_asked: 18, day_asked_on: ymd(-1) }, 550), null);
  assert.equal(asked({ day_asked: 36, day_asked_on: ymd(-1) }, 1100), null);
  // A year mistyped at sign-up: "18 months" was settled 100 days ago; by the corrected birth
  // date the child turned one 4 days ago. The offer comes at the true day 366.
  assert.deepEqual(asked({ day_asked: 18, day_asked_on: ymd(-100), day: stored({ saved_on: ymd(-100) }) }), { band: 12, words: "Lana is one. Look at her day", early: true });
  for (const s of [null, undefined, "x", []]) assert.ok(offer(370, { settings: s }), JSON.stringify(s));
});

// ---- the entry types a home offers ---------------------------------------------------------------

const feed = { id: "lana.feed", label: "Feed", fields: [{ key: "method" }], settings: { timer: true } };
const mealType = { id: "lana.meal", label: "Meal", fields: [], settings: {} };
const bare = { id: "lana.note", label: "Note" }; // a row with no settings at all, as the helper's test rows have
const nulled = { id: "lana.mood", label: "Mood", settings: null };
const pottyType = { id: "lana.potty", label: "Potty", settings: { needs: "potty" } };
const other = { id: "lana.x", label: "X", settings: { needs: "something else" } };
const TYPES = [feed, mealType, bare, nulled, pottyType, other];
const same = (got: readonly unknown[], want: readonly unknown[]) => {
  assert.equal(got.length, want.length);
  got.forEach((g, i) => assert.equal(g, want[i], "the same object, not a copy"));
};

test("typesForDay and typesOn: the same objects, less a row the day has not turned on", () => {
  const open = [feed, mealType, bare, nulled];
  // No day: a baby's home, a child with no birth date, a toddler's home.
  for (const age of [null, 120, 365, 400, 1111]) {
    const plan = dayPlan(null, age, BUSY);
    same(typesForDay(TYPES, plan), open);
    same(typesOn(TYPES, plan.on), open);
    same(typesForDay(open, plan), open);
  }
  // A day: the gate alone, in any home, whatever the milk and the stash.
  for (const d of DAYS) {
    for (const age of [400, AGE]) {
      const plan = dayPlan(d, age, BUSY);
      const want = plan.on.potty ? [...open, pottyType] : open;
      same(typesForDay(TYPES, plan), want);
      same(typesOn(TYPES, plan.on), want);
      assert.deepEqual(typesOn(TYPES, plan.on), TYPES.filter((t) => t !== other && (t !== pottyType || plan.on.potty)), "the stored rows minus the hidden one");
    }
  }
  assert.equal(dayPlan(day({ diapers: "both" }), AGE, BUSY).on.potty, true);
  assert.equal(dayPlan(day({ diapers: "both" }), 400, BUSY).on.potty, false);
  // Nothing is added to a row and nothing changed: twice is once.
  const plan = dayPlan(day({ milk: "drink", diapers: "potty", stores_milk: false }), AGE, BUSY);
  same(typesForDay(typesForDay(TYPES, plan), plan), [feed, mealType, bare, nulled, pottyType]);
  assert.deepEqual(feed, { id: "lana.feed", label: "Feed", fields: [{ key: "method" }], settings: { timer: true } });
  // An entry being edited keeps its own type, whatever the day says.
  same(typesForDay([pottyType], dayPlan(day(), AGE, BUSY), { keep: { kind: "Wee" } }), [pottyType]);
  same(typesForDay([pottyType], dayPlan(day(), AGE, BUSY)), []);
});

test("dayFacts: read off home_summary and the week, the newest of each kind by when it happened", () => {
  const summary = {
    types: [{ key: "feed" }, { key: "meal" }, { key: "note" }],
    last: {
      "lana.feed": { occurred_at: iso(at(0, "07:00")), ended_at: iso(at(0, "07:20")) },
      "lana.pump": null,
      "lana.meal": { occurred_at: iso(at(-1, "18:00")) },
    },
  };
  const week = [
    { type_id: "lana.feed", occurred_at: iso(at(-2, "06:00")), payload: { method: "Breast" } },
    { type_id: "lana.feed", occurred_at: iso(at(0, "07:00")), payload: { method: "Bottle" } },
  ];
  const f = dayFacts(summary, { now: NOW, today: TODAY, tz: TZ, breastfeeds: true, inStock: true, week, pattern: { expected: false, napsToday: 2 } });
  assert.deepEqual(f, {
    now: NOW, today: TODAY, tz: TZ, has: { meal: true, pump: false, potty: false, note: true }, breastfeeds: true, lastPumpAt: null, inStock: true,
    lastFeedAt: iso(at(0, "07:00")), lastDiaperAt: null, lastMealAt: iso(at(-1, "18:00")), lastPottyAt: null, breastLately: true, napExpected: false, napsToday: 2,
  });
  // A breastfeed from more than a week back is not "lately"; a summary that failed to load knows nothing.
  assert.equal(dayFacts(summary, { now: NOW, today: TODAY, tz: TZ, breastfeeds: true, inStock: false, week: [{ type_id: "lana.feed", occurred_at: iso(at(-9, "06:00")), payload: { method: "Breast" } }], pattern: { expected: true, napsToday: 0 } }).breastLately, false);
  const none = dayFacts(null, { now: NOW, today: TODAY, tz: TZ, breastfeeds: false, inStock: false, week: [], pattern: { expected: true, napsToday: 0 } });
  assert.deepEqual(none.has, { meal: false, pump: false, potty: false, note: false });
  assert.equal(none.lastFeedAt, null);
  // With no day a plan from these facts is the plan from the same facts written out by hand.
  assert.deepEqual(dayPlan(null, 400, f), dayPlan(null, 400, { ...f, has: { meal: true, pump: false, potty: false } }));
});

test("milkTab: gone only when a readable day says no milk is stored", () => {
  assert.equal(milkTab(stored({ stores_milk: false })), false);
  assert.equal(milkTab(day({ stores_milk: false })), false);
  assert.equal(milkTab(stored({ stores_milk: true })), true);
  for (const d of [undefined, null, "x", 0, [], {}, stored({ v: 2, stores_milk: false }), stored({ milk: "x", stores_milk: false }), stored({ naps: 3, stores_milk: false }), { stores_milk: false }]) assert.equal(milkTab(d), true, JSON.stringify(d));
});

test("pottyCount: a wee or a poo counts, a try or an accident does not", () => {
  const e = (type_id: string, kind?: string) => ({ type_id, payload: kind ? { kind } : {} });
  assert.equal(pottyCount([e("lana.potty", "Wee"), e("lana.potty", "Poo"), e("lana.potty", "Tried"), e("lana.potty", "Accident"), e("lana.potty"), e("lana.diaper", "Wet"), e("lana.diaper", "Poo")]), 2);
  assert.equal(pottyCount([]), 0);
});
