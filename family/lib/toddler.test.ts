/**
 * The age rules from 12 months (step 1, "say nothing false to a toddler's family"), one rule
 * at a time, each from both sides of its edge day: 364, 365 (a baby) and 366 (a toddler);
 * 547 and 548; 730 and 731; 1095 and 1096. What Home says over whole days is in
 * lib/toddler-days.test.ts. A baby's results are pinned by lib/golden-baby.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { awakeWindow, defaultNaps, isToddler, napsLine, pumpingActive, stageOf } from "./stage.ts";
import { ageLabel, ageWords, ageWordsShort, averagesLine, checkDay, dayAverages, NO_USUAL, normsForAge, normsSource, type AverageDay, type DayTotals } from "./norms.ts";
import { tipsFor, topicsFor } from "./child-guide.ts";
import { checkEntries, type CheckEntry } from "./entry-checks.ts";
import { daySchedule, phaseCard, sleepCoach } from "./child-insights.ts";
import { pronouns, sexOf } from "./names.ts";
import { curveNote, percentileOf, reference } from "./who.ts";
import { defaultMilk } from "./milk-take.ts";
import { feedCard, foodHeadline, kindsLoggedLately, loggedLately, stripCells } from "./logged.ts";
import { at, bornAgo, bottle, diaper, everyDay, FAMILIES, familyLog, hourOf, iso, meal, msOf, readAt, sleep, TODAY, TZ, ymd } from "./fixtures/toddler-days.ts";

const EDGES = [364, 365, 366, 547, 548, 730, 731, 1095, 1096];
const TODDLER_AGES = [366, 380, 456, 548, 563, 731, 746, 1096, 1111];

// ---- who is a toddler, and the stage table (R4) ------------------------------------------------

test("a toddler from day 366: day 365 and a child with no birth date are babies", () => {
  assert.deepEqual([364, 365, 366, 400].map(isToddler), [false, false, true, true]);
  assert.equal(isToddler(null), false);
  assert.equal(isToddler(undefined), false);
  for (const d of [0, 120, 365]) assert.deepEqual([stageOf(d).toddler, stageOf(d).milkClock], [false, true], `day ${d}`);
  for (const d of TODDLER_AGES) assert.deepEqual([stageOf(d).toddler, stageOf(d).milkClock], [true, false], `day ${d}`);
  assert.deepEqual(stageOf(365).limits, { longSleepMin: 600, bigBottleMl: 240, awakeKnownMin: 720 });
  assert.deepEqual(stageOf(366).limits, { longSleepMin: 780, bigBottleMl: 350, awakeKnownMin: 960 });
});

test("the bands: 2 years and over splits at 3 years; naps stay 1–2, 1, 0–1, 0–1", () => {
  const at = (d: number) => [stageOf(d).band, stageOf(d).label, stageOf(d).naps];
  assert.deepEqual(EDGES.map((d) => stageOf(d).band), ["9-12", "9-12", "12-18", "12-18", "18-24", "18-24", "24-36", "24-36", "36+"]);
  assert.deepEqual(at(400), ["12-18", "12 to 18 months", [1, 2]]);
  assert.deepEqual(at(600), ["18-24", "18 to 24 months", [1, 1]]);
  assert.deepEqual(at(731), ["24-36", "2 to 3 years", [0, 1]]);
  assert.deepEqual(at(1096), ["36+", "3 years and over", [0, 1]]);
});

test("awake time before a nap: a baby's as before whatever the naps; a toddler's by age and by one nap or two", () => {
  for (let d = 0; d <= 365; d++) {
    const base = awakeWindow(d, null);
    for (const n of [0, 1, 2, 3]) assert.deepEqual(awakeWindow(d, n), base, `day ${d}`);
  }
  assert.deepEqual([179, 180, 181, 182, 183].map((d) => awakeWindow(d, null)), [[105, 150], [120, 180], [120, 180], [120, 180], [120, 180]], "days 180 to 182 as on main");
  assert.deepEqual(awakeWindow(365, null), [150, 210]);
  // 12 to 17 months: two naps, or one; with nothing to go by, two before 15 months and one from 15.
  assert.deepEqual([awakeWindow(366, 2), awakeWindow(366, 1), awakeWindow(366, 0), awakeWindow(366, null)], [[180, 240], [270, 360], [270, 360], [180, 240]]);
  assert.deepEqual([defaultNaps(456), defaultNaps(457)], [2, 1]);
  assert.deepEqual([awakeWindow(456, null), awakeWindow(457, null), awakeWindow(457, 2)], [[180, 240], [270, 360], [180, 240]]);
  assert.deepEqual([547, 548, 730, 731, 1095, 1096].map((d) => awakeWindow(d, null)), [[270, 360], [300, 360], [300, 360], [300, 390], [300, 390], [360, 420]]);
  assert.deepEqual(awakeWindow(600, 2), [300, 360], "from 18 months the naps do not move it");
  assert.deepEqual(stageOf(1096).awake, [360, 420]);
});

test("the nap count: a plain count when the usual range starts at 0, never 'of 0–1' or 'yet'", () => {
  assert.equal(napsLine(0, [0, 1], true), "no nap");
  assert.equal(napsLine(0, [0, 1], false), "no nap");
  assert.equal(napsLine(1, [0, 1], true), "1 nap");
  assert.equal(napsLine(2, [0, 1], true), "2 naps");
  // From 1 nap up, as today.
  assert.equal(napsLine(1, [1, 2], true), "1 of 1–2 naps");
  assert.equal(napsLine(0, [1, 1], true), "no nap yet, usually 1");
  assert.equal(napsLine(3, [1, 2], true), "3 naps");
});

// ---- the guide is silent (R1) ------------------------------------------------------------------

test("the guide is silent from 12 months: the four normal weeks, an empty log and a bad day give no tip", () => {
  for (const f of Object.values(FAMILIES)) {
    const log = familyLog(f);
    for (const hh of ["07:00", "10:00", "13:00", "16:00", "20:00"]) {
      const now = at(0, hh);
      assert.deepEqual(tipsFor(readAt(log, now), bornAgo(f.ageDays), msOf(now), { timezone: TZ, feedGapMin: 180, name: f.name, sex: f.sex }), [], `${f.name} at ${hh}`);
    }
  }
  const bad = [bottle(at(0, "06:00"), 30), diaper(at(-1, "06:00")), sleep(at(0, "09:00"), at(0, "09:10"))];
  for (const age of TODDLER_AGES) {
    for (const log of [[], bad]) assert.deepEqual(tipsFor(readAt(log, at(0, "13:00")), bornAgo(age), msOf(at(0, "13:00")), { timezone: TZ, name: "Noor", sex: "Girl" }), [], `day ${age}`);
  }
  // Day 365 is still a baby: an empty day is still asked about.
  assert.equal(tipsFor([], bornAgo(365), msOf(at(0, "13:00")), { timezone: TZ })[0].title, "Nothing logged in 24 hours");
  assert.equal(tipsFor([], bornAgo(366), msOf(at(0, "13:00")), { timezone: TZ }).length, 0);
});

// ---- what is usual (R3) ------------------------------------------------------------------------

test("the norms rows: a label for each, and no usual number of feeds, bottles or diapers from 12 months", () => {
  assert.deepEqual([0, 30, 31, 91, 92, 182, 183, 364, 365].map((d) => normsForAge(d).label), ["First month", "First month", "1 to 3 months", "1 to 3 months", "3 to 6 months", "3 to 6 months", "6 to 12 months", "6 to 12 months", "6 to 12 months"]);
  assert.deepEqual(normsForAge(365).feeds, { low: 4, high: 6, flagLow: true, note: "Plus solids." });
  for (const d of [366, 731, 1095]) {
    const n = normsForAge(d);
    assert.equal(n.label, "12 to 35 months", `day ${d}`);
    assert.deepEqual([n.feeds, n.bottleMl, n.wet, n.dirty], [null, null, null, null]);
    assert.deepEqual(n.sleepMin, { low: 660, high: 840, flagLow: false, note: undefined });
    assert.deepEqual(n.nightSleepMin, { low: 600, high: 720, flagLow: false, note: undefined });
  }
  const three = normsForAge(1096);
  assert.equal(three.label, "3 years and over");
  assert.deepEqual([three.feeds, three.wet, three.sleepMin.low, three.sleepMin.high, three.sleepMin.flagLow], [null, null, 600, 780, false]);
  assert.equal(normsSource(365), "Ranges from the NHS, the AAP and the National Sleep Foundation. Only what was logged counts. Not medical advice.");
  assert.equal(normsSource(366), "Sleep ranges from the AASM and the WHO. Only what was logged counts. Not medical advice.");
});

const ALL = { feed: true, diaper: true, sleep: true };
const zero: DayTotals = { breast_count: 0, bottle_count: 0, bottle_ml: 0, diapers_wet: 0, diapers_dirty: 0, sleep_min: 180, night_sleep_min: 0 };

test("against her age from 12 months: a plain count with no usual number, never judged, and only the kinds logged", () => {
  const rows = checkDay({ ...zero, diapers_wet: 2, diapers_dirty: 1 }, 400, true, { feed: false, diaper: true, sleep: true });
  assert.deepEqual(rows.map((r) => r.key), ["wet", "dirty", "sleep", "night"], "no feeds row when no feed was logged");
  assert.deepEqual(rows.map((r) => r.verdict), ["ok", "ok", "ok", "ok"], "3 hours of sleep is shown, not flagged");
  assert.deepEqual(rows[0], { key: "wet", label: "Wet diapers", value: "2", typical: "", verdict: "ok", note: NO_USUAL });
  assert.equal(rows[2].typical, "11 to 14 h");
  assert.equal(rows[3].typical, "10 to 12 h");
  assert.equal(checkDay(zero, 1096, true, ALL).find((r) => r.key === "sleep")!.typical, "10 to 13 h");
  const fed = checkDay({ ...zero, bottle_count: 2, bottle_ml: 380 }, 380, false, ALL);
  assert.deepEqual(fed.slice(0, 2).map((r) => [r.key, r.value, r.typical, r.note, r.verdict]), [["feeds", "2", "", NO_USUAL, "so_far"], ["ml", "380 ml", "", NO_USUAL, "so_far"]]);
  assert.deepEqual(checkDay(zero, 400, true, { feed: false, diaper: false, sleep: false }), []);
  // A baby's rows do not hear about what was logged: all six, judged as on main.
  const baby = checkDay(zero, 365, true, { feed: false, diaper: false, sleep: false });
  assert.deepEqual(baby.map((r) => r.key), ["feeds", "wet", "dirty", "sleep", "night"]);
  assert.equal(baby[0].verdict, "short");
});

// ---- a day's average over the days logged (X8, R3) ------------------------------------------------

const statDay = (day: number, over: Partial<AverageDay> = {}): AverageDay => ({ day: ymd(day), breast_count: 0, bottle_count: 0, bottle_ml: 0, diapers: 0, diapers_wet: 0, diapers_dirty: 0, sleep_min: 0, night_sleep_min: 0, ...over });
const logged = (day: number) => statDay(day, { breast_count: 3, bottle_count: 2, bottle_ml: 240, diapers: 5, diapers_wet: 4, diapers_dirty: 1, sleep_min: 780, night_sleep_min: 660 });

test("a day's average: with every day logged, the plain mean of the 7 days", () => {
  const days = [-7, -6, -5, -4, -3, -2, -1].map((d) => (d === -3 ? statDay(d, { ...logged(d), bottle_count: 4, bottle_ml: 600, sleep_min: 600 }) : logged(d)));
  const a = dayAverages(days, null, false);
  assert.equal(a.totals.bottle_count, 16 / 7);
  assert.equal(a.totals.bottle_ml, (6 * 240 + 600) / 7);
  assert.equal(a.totals.sleep_min, (6 * 780 + 600) / 7);
  assert.deepEqual([a.days, a.loggedDays, a.everyDay], [7, 7, true]);
  assert.equal(averagesLine(a, "this week"), null, "the screen's own subtitle stays");
});

test("a day's average counts only the days its kind was logged; a zero inside a counted day stays a zero", () => {
  // The family began four days ago: three empty days are not days of nothing.
  const days = [-7, -6, -5, -4, -3, -2, -1].map((d) => (d < -4 ? statDay(d) : d === -2 ? statDay(d, { ...logged(d), bottle_count: 0, bottle_ml: 0 }) : logged(d)));
  const a = dayAverages(days, null, false);
  assert.equal(a.totals.breast_count, 3);
  assert.equal(a.totals.bottle_count, 6 / 4, "the breastfeeding-only day counts with no bottle");
  assert.equal(a.totals.diapers_wet, 4);
  assert.equal(a.totals.sleep_min, 780);
  assert.deepEqual(a.counted, { feed: 4, diaper: 4, sleep: 4 });
  assert.equal(averagesLine(a, "this week"), "A day's average over the 4 days logged this week.");
  // Chosen by the kind of entry: diapers on 2 days only average over those 2.
  const some = days.map((d, i) => (i < 5 ? { ...d, diapers: 0, diapers_wet: 0, diapers_dirty: 0 } : d));
  const b = dayAverages(some, null, false);
  assert.deepEqual([b.counted.diaper, b.totals.diapers_wet, b.mean("diapers")], [2, 4, 5]);
  assert.deepEqual(b.logged, { feed: true, diaper: true, sleep: true });
  // Nothing of a kind: not listed (checkDay's logged), and its numbers are 0.
  const noFeeds = dayAverages(days.map((d) => ({ ...d, breast_count: 0, bottle_count: 0, bottle_ml: 0 })), null, true);
  assert.deepEqual([noFeeds.logged.feed, noFeeds.totals.breast_count], [false, 0]);
});

test("a toddler's sleep averages use whole days only: it and the day before both have night sleep", () => {
  // The first evening: the family started at 19:30 four days ago. That day holds 4 h 30 min of sleep.
  const first = statDay(-4, { sleep_min: 270, night_sleep_min: 690 });
  const whole = (d: number) => statDay(d, { sleep_min: 13 * 60, night_sleep_min: 690, nap_count: 1 });
  const days = [statDay(-7), statDay(-6), statDay(-5), first, whole(-3), whole(-2), whole(-1)];
  const toddler = dayAverages(days, null, true);
  assert.equal(toddler.counted.sleep, 3);
  assert.equal(toddler.totals.sleep_min, 13 * 60, "not pulled down to 10 h 52 min by the first evening");
  assert.equal(dayAverages(days, null, false).totals.sleep_min, (270 + 3 * 780) / 4, "a baby's sleep averages over any day with sleep, as X8 says");
  // The first day of the period counts when the day before it, fetched too, had night sleep.
  const fullWeek = [-7, -6, -5, -4, -3, -2, -1].map(whole);
  assert.equal(dayAverages(fullWeek, whole(-8), true).counted.sleep, 7);
  assert.equal(dayAverages(fullWeek, null, true).counted.sleep, 6, "without the day before, the first day cannot be shown whole");
  assert.equal(dayAverages(fullWeek, whole(-8), true).everyDay, true);
});

// ---- entry checks (R6) ---------------------------------------------------------------------------

const T0 = Date.parse("2026-11-10T15:00:00Z"); // 19:00 in Dubai
let n = 0;
const mk = (type: string, startMin: number, endMin: number | null = null, payload: Record<string, unknown> = {}): CheckEntry => ({ id: `e${++n}`, type_id: `lana.${type}`, occurred_at: new Date(T0 + startMin * 60_000).toISOString(), ended_at: endMin == null ? null : new Date(T0 + endMin * 60_000).toISOString(), payload });
const NOW = T0 + 24 * 3_600_000;
const flagsAt = (ageDays: number | null, entries: CheckEntry[]) => checkEntries(entries, { now: NOW, ageDays }).map((f) => [f.kind, f.title, f.detail]);

test("entry checks from 12 months: a sleep is asked about over 13 hours, a bottle over 350 ml", () => {
  assert.deepEqual(flagsAt(366, [mk("sleep", 0, 11 * 60)]), [], "an 11 h night is a night");
  assert.deepEqual(flagsAt(366, [mk("sleep", 0, 13 * 60)]), []);
  assert.deepEqual(flagsAt(366, [mk("sleep", 0, 13 * 60 + 1)]), [["long_sleep", "Sleep of 13 h 1 min", "Over 13 hours in one go is rare; was the timer left on?"]]);
  assert.deepEqual(flagsAt(366, [mk("sleep", 0, 14 * 60)]), [["long_sleep", "Sleep of 14 h", "Over 13 hours in one go is rare; was the timer left on?"]]);
  assert.deepEqual(flagsAt(366, [mk("feed", 60, null, { method: "Bottle", amount_ml: 300 })]), [], "300 ml is a toddler's cup");
  assert.deepEqual(flagsAt(366, [mk("feed", 60, null, { method: "Bottle", amount_ml: 350 })]), []);
  assert.deepEqual(flagsAt(366, [mk("feed", 60, null, { method: "Bottle", amount_ml: 400 })]), [["big_bottle", "Bottle of 400 ml", "Over 350 ml in one bottle is unusual at this age. A typo?"]]);
  // Day 365 and no birth date: a baby's limits, as on main.
  for (const age of [365, null]) {
    assert.deepEqual(flagsAt(age, [mk("sleep", 0, 11 * 60)]), [["long_sleep", "Sleep of 11 h", "Over 10 hours in one go is rare; was the timer left on?"]]);
    assert.deepEqual(flagsAt(age, [mk("feed", 60, null, { method: "Bottle", amount_ml: 300 })]), [["big_bottle", "Bottle of 300 ml", "Over 240 ml in one bottle is unusual at this age. A typo?"]]);
  }
  for (const age of [547, 548, 730, 731, 1095, 1096]) assert.deepEqual(flagsAt(age, [mk("sleep", 0, 12 * 60), mk("feed", 13 * 60, null, { method: "Bottle", amount_ml: 330 })]), [], `day ${age}`);
});

test("entry checks from 12 months: only a feed, a diaper or a sleep logged during a sleep says the timer was left on", () => {
  const night = () => mk("sleep", 0, 11 * 60);
  for (const [what, entry] of [["a note", mk("note", 240)], ["a meal", mk("meal", 240)], ["a pump", mk("pump", 240)], ["a mood", mk("mood", 240)], ["a night wake", mk("wake", 240, 260)]] as [string, CheckEntry][]) {
    assert.deepEqual(flagsAt(366, [night(), entry]), [], `${what} during a night`);
  }
  for (const [what, entry] of [["a diaper", mk("diaper", 240, null, { kind: "Wet" })], ["a bottle", mk("feed", 240, null, { method: "Bottle", amount_ml: 120 })], ["another sleep", mk("sleep", 240, 300)]] as [string, CheckEntry][]) {
    assert.equal(flagsAt(366, [night(), entry])[0]?.[0], "overlap", `${what} during a night`);
  }
  // A baby: a note during a sleep is still a sign, as on main.
  assert.equal(flagsAt(365, [mk("sleep", 0, 9 * 60), mk("note", 240)])[0]?.[0], "overlap");
});

test("the four normal weeks give no entry to check", () => {
  for (const f of Object.values(FAMILIES)) {
    const now = msOf(at(0, "20:00"));
    assert.deepEqual(checkEntries(readAt(familyLog(f), at(0, "20:00")), { now, ageDays: f.ageDays }), [], f.name);
  }
});

// ---- stored milk (R7) -------------------------------------------------------------------------------

test("pumping goes on: for a toddler only with a pump in the last 14 days; 'none ever' counts for a baby only", () => {
  const now = msOf(at(0, "13:00"));
  const ago = (days: number) => new Date(now - days * 86_400_000).toISOString();
  assert.deepEqual([pumpingActive(null, now, 365), pumpingActive(null, now, null), pumpingActive(null, now, 366)], [true, true, false]);
  assert.deepEqual([ago(13), ago(14), ago(14 + 1 / 1440)].map((p) => pumpingActive(p, now, 366)), [true, true, false]);
  assert.deepEqual([ago(13), ago(15)].map((p) => pumpingActive(p, now, 365)), [true, false]);
});

// ---- when to call the doctor (R9, X9) ------------------------------------------------------------------

test("when to call the doctor for a baby: today's text, Feeding's first sentence from the child's own row", () => {
  const feeding = (d: number | null) => topicsFor(d).find((t) => t.id === "feeds")!.normal;
  const after = " Steady weight gain and enough wet diapers mean the baby is getting enough.";
  assert.equal(feeding(null), `3 to 6 months: usually 6 to 8 feeds in 24 hours.${after}`, "no birth date: as on main");
  assert.equal(feeding(165), `3 to 6 months: usually 6 to 8 feeds in 24 hours.${after}`, "Lana today, as on main");
  assert.equal(feeding(182), `3 to 6 months: usually 6 to 8 feeds in 24 hours.${after}`, "Lana on 4 December");
  assert.equal(feeding(183), `6 to 12 months: usually 4 to 6 feeds in 24 hours, plus solids.${after}`, "Lana from 5 December");
  assert.equal(feeding(365), `6 to 12 months: usually 4 to 6 feeds in 24 hours, plus solids.${after}`);
  assert.equal(feeding(0), `First month: usually 8 to 12 feeds in 24 hours.${after}`);
  assert.equal(feeding(31), `1 to 3 months: usually 7 to 9 feeds in 24 hours.${after}`);
  // Nothing else moves for a baby.
  for (const d of [0, 165, 365]) assert.deepEqual(topicsFor(d).map((t) => ({ ...t, normal: t.id === "feeds" ? "" : t.normal })), topicsFor(null).map((t) => ({ ...t, normal: t.id === "feeds" ? "" : t.normal })));
});

test("when to call the doctor from 12 months: only taken away, 'your child', and from 24 months no soft spot or diaper", () => {
  const baby = topicsFor(365);
  for (const d of [366, 730, 731, 1096]) {
    const t = topicsFor(d);
    assert.deepEqual(t.map((x) => x.id), ["nappies", "poo", "feeds", "sleep", "fever"]);
    assert.deepEqual(t.map((x) => x.normal), ["", "", "", "", "A normal temperature is about 36.5 to 37.5 °C."]);
    const lines = t.flatMap((x) => [...x.call, ...x.emergency]);
    for (const gone of ["Fewer than 6 wet diapers in 24 hours, or very light ones", "3 to 6 months: temperature of 39 °C or higher", "Under 3 months: any temperature of 38 °C or higher"]) assert.ok(!lines.includes(gone), `${gone} at day ${d}`);
    assert.ok(!lines.some((l) => /\bbaby\b/i.test(l)), `no "baby" at day ${d}`);
    assert.ok(lines.includes("Your child seems unwell and you are worried. Trust your instinct."));
    assert.ok(lines.includes("No poo for 4 or more days and your child seems uncomfortable"));
    assert.ok(t.every((x, i) => x.call.length <= baby[i].call.length && x.emergency.length <= baby[i].emergency.length), "no line is added");
    assert.deepEqual(t.map((x) => x.src), baby.map((x) => x.src));
  }
  const em = (d: number) => topicsFor(d).flatMap((x) => x.emergency);
  assert.ok(em(730).includes("Sunken soft spot on top of the head or sunken eyes") && em(730).includes("No wet diaper for 12 hours or more"));
  assert.ok(em(731).includes("Sunken eyes") && em(731).includes("Stiff neck or high-pitched cry") && em(731).includes("No wee for 12 hours or more"));
  assert.ok(!em(731).some((l) => /soft spot|diaper/.test(l)));
});

// ---- what this age brings (R10) --------------------------------------------------------------------

test("what this age brings: a toddler's heading in words, one link to the stretch, no awake window; none past week 156", () => {
  const lana = phaseCard("2026-06-05", TODAY, "Lana")!;
  assert.equal(lana.heading, "What to expect at 5.4 months", "a baby's card as on main");
  assert.equal(lana.foot, "Usual awake window 105 to 150 min. Every baby differs; Lana sets the pace.");
  assert.equal(lana.link, "Week 23: five months: rolling and reaching ›");
  assert.equal(phaseCard(bornAgo(330), TODAY, "Lana")!.quiet, "A quieter stretch: no big change is usual right now.");
  assert.equal(phaseCard(bornAgo(365), TODAY, "Lana")!.link, "Week 52: one year: first steps and words ›");
  const noor = phaseCard(bornAgo(380), TODAY, "Noor")!;
  assert.deepEqual(noor, { heading: "What to expect at 12 months", now: [], quiet: null, coming: null, foot: "Every child differs; Noor sets the pace.", link: "One year: first steps and words ›" });
  assert.equal(phaseCard(bornAgo(746), TODAY, "Maya")!.heading, "What to expect at 2 years");
  assert.equal(phaseCard(bornAgo(1095), TODAY, "Maya")!.link, "Two and a half to three ›");
  assert.equal(phaseCard(bornAgo(1099), TODAY, "Yusuf"), null, "week 157: no stretch, no card");
  assert.equal(phaseCard(bornAgo(1111), TODAY, "Yusuf"), null);
});

// ---- the age in words (X7) -----------------------------------------------------------------------------

test("the age in words counts calendar months: Lana's label moves on five days of her first year, each a birthday or the day before", () => {
  const changed: string[] = [];
  for (let d = 0; d <= 366; d++) {
    const day = new Date(Date.parse("2026-06-05") + d * 86_400_000).toISOString().slice(0, 10);
    if (ageWords("2026-06-05", day) !== ageLabel(d)) changed.push(`${day}: ${ageLabel(d)} > ${ageWords("2026-06-05", day)}`);
  }
  assert.deepEqual(changed, ["2027-02-04: 8 months > 7 months", "2027-03-05: 8 months > 9 months", "2027-04-05: 9 months > 10 months", "2027-05-05: 10 months > 11 months", "2027-06-05: 11 months > 12 months"]);
});

test("the age in words on birthdays, from 2 years in years, for a 29 February birth and a birth on the 31st", () => {
  assert.deepEqual(["2025-11-30", "2025-12-14", "2026-02-22", "2026-03-15"].map((d) => ageWords("2025-11-17", d)), ["13 days", "3 weeks", "13 weeks", "3 months"]);
  assert.deepEqual(["2026-11-16", "2026-11-17", "2027-05-17", "2027-11-16", "2027-11-17", "2028-02-17", "2028-11-17"].map((d) => ageWords("2025-11-17", d)), ["11 months", "12 months", "18 months", "23 months", "2 years", "2 years 3 months", "3 years"]);
  assert.deepEqual(["2025-02-27", "2025-02-28", "2026-02-28", "2026-03-29", "2028-02-29"].map((d) => ageWords("2024-02-29", d)), ["11 months", "12 months", "2 years", "2 years 1 month", "4 years"]);
  assert.deepEqual(["2026-08-30", "2026-08-31", "2026-09-29", "2026-09-30", "2027-02-28"].map((d) => ageWords("2024-08-31", d)), ["23 months", "2 years", "2 years", "2 years 1 month", "2 years 6 months"]);
  // Home's header: whole years only from 2 years, so the line still fits.
  assert.deepEqual(["2026-09-30", "2027-02-28", "2027-08-31"].map((d) => ageWordsShort("2024-08-31", d)), ["2 years", "2 years", "3 years"]);
  assert.deepEqual([ageWordsShort("2025-11-17", "2027-05-17"), ageWordsShort("2026-06-05", TODAY), ageWordsShort("2026-11-07", TODAY)], ["18 months", "5 months", "10 days"]);
  // With no birth date, days alone: years from 24 months.
  assert.deepEqual([730, 731, 800, 1096].map(ageLabel), ["23 months", "2 years", "2 years 2 months", "3 years"]);
});

// ---- a girl, a boy and no sex (X3, X4) ---------------------------------------------------------------------

test("sexOf reads exactly the spellings pronouns always read", () => {
  assert.deepEqual(["Girl", "girl", "GIRL", "Female", "female", "F", "f"].map(sexOf), Array(7).fill("girl"));
  assert.deepEqual(["Boy", "boy", "BOY", "Male", "male", "M", "m"].map(sexOf), Array(7).fill("boy"));
  assert.deepEqual(["", " girl", "girls", "woman", "g", "Other", null, undefined].map(sexOf), Array(8).fill(null));
  assert.deepEqual([pronouns("Girl"), pronouns("Boy"), pronouns(null)].map((p) => `${p.they} ${p.was}, ${p.they} nap${p.s}, ${p.they} ${p.is}`), ["she was, she naps, she is", "he was, he naps, he is", "they were, they nap, they are"]);
});

/** Fourteen days of a night from 19:30 and one nap a day `before` minutes after waking at 07:00. */
const napsAfter = (before: number, napMin = 90) => [...everyDay([["sleep", -1, "19:30", 0, "07:00", {}]], -13, 0), ...Array.from({ length: 13 }, (_, i) => sleep(at(-13 + i, "07:00") + before, at(-13 + i, "07:00") + before + napMin))];
const coach = (age: number, sex: string | null, drafts = napsAfter(400), naps: number | null = null) => sleepCoach(readAt(drafts, at(0, "13:00"), 14), age, hourOf, sex, naps)!;

test("the sleep coach's sentence follows the child: a girl's bytes as before, a boy's and no sex's in English", () => {
  const baby = (sex: string | null) => coach(300, sex, napsAfter(250)).tip;
  assert.equal(baby("Girl"), "She naps best after 250 min awake, longer than usual for her age (150 to 210). That is fine if she is content.");
  assert.equal(baby("Boy"), "He naps best after 250 min awake, longer than usual for his age (150 to 210). That is fine if he is content.");
  assert.equal(baby(null), "They nap best after 250 min awake, longer than usual for their age (150 to 210). That is fine if they are content.");
  assert.equal(coach(300, "Boy", napsAfter(150)).tip, "His longest naps come after about 150 min awake. Try starting the wind-down around then.");
  assert.equal(coach(300, null, napsAfter(150, 30)).tip, "Many naps are short, about 30 min. A darker room and white noise can help them link sleep cycles.");
});

test("the sleep coach from 12 months: hours and minutes, awake stretches up to 8 hours, and a child with no nap", () => {
  // 400 days, one nap a day after 6 h 40 min awake: a baby's learner dropped every stretch over 5 hours.
  const one = coach(400, "Girl", napsAfter(400), 1);
  assert.equal(one.bestWindowMin, 400);
  assert.equal(one.tip, "She naps best after 6 h 40 min awake, longer than usual for her age (4 h 30 min to 6 h). That is fine if she is content.");
  assert.match(coach(400, "Girl", napsAfter(400), null).tip, /\(3 h to 4 h\)/, "with no pattern given, two naps before 15 months");
  assert.deepEqual(one.rows, [{ label: "Usual nap", value: "1 h 30 min" }, { label: "Awake before the best naps", value: "6 h 40 min" }, { label: "Usual bedtime", value: "19:30" }]);
  assert.equal(coach(365, "Girl").bestWindowMin, null, "day 365 keeps a baby's 5-hour cap");
  assert.equal(coach(600, "Boy", napsAfter(330)).tip, "His longest naps come after about 5 h 30 min awake. Try starting the wind-down around then.");
  // No daytime nap in the 14 days: one line, and only the usual bedtime.
  const none = sleepCoach(readAt(everyDay([["sleep", -1, "19:30", 0, "07:00", {}]], -13, 0), at(0, "13:00"), 14), 913, hourOf, "Girl", 0)!;
  assert.equal(none.tip, "No daytime naps in the last 14 days.");
  assert.deepEqual(none.rows, [{ label: "Usual bedtime", value: "19:30" }]);
  // A baby's rows are the screen's rows of today, in minutes.
  assert.deepEqual(coach(300, "Girl", napsAfter(150)).rows, [{ label: "Usual nap", value: "90 min" }, { label: "Awake before the best naps", value: "150 min" }, { label: "Usual bedtime", value: "19:30" }]);
});

test("growth: the WHO curve and percentile for a girl up to 24 months only; a line for everyone else", () => {
  for (const sex of ["Girl", "f", "FEMALE"]) assert.ok(reference("weight_kg", 365, sex) && percentileOf("weight_kg", 365, 8.9, sex) === 50, sex);
  for (const sex of ["Boy", "m", null, "", "Other"]) assert.deepEqual([reference("weight_kg", 365, sex), percentileOf("weight_kg", 365, 8.9, sex)], [null, null], String(sex));
  assert.ok(reference("length_cm", 730, "Girl"));
  assert.equal(reference("length_cm", 731, "Girl"), null);
  assert.deepEqual([curveNote("Girl", 300), curveNote("Girl", 730)], [null, null]);
  assert.equal(curveNote("Girl", 731), "The WHO curves here stop at 2 years.");
  assert.equal(curveNote("Boy", 300), "No WHO curve for boys here yet. The doctor's chart is the reference.");
  assert.equal(curveNote(null, 300), "Add girl or boy on the health card to see the WHO curves.");
});

// ---- the first bottle's milk (X10) --------------------------------------------------------------------

test("the first bottle's milk: the last bottle's, else Morning pumped where milk is pumped or kept, else nothing", () => {
  const none = { lastMilk: null, everPumped: false, inStock: false, namedMilkThisWeek: false };
  assert.equal(defaultMilk({ ...none, lastMilk: "Formula", everPumped: true }), "Formula");
  assert.equal(defaultMilk({ lastMilk: null, everPumped: true, inStock: false, namedMilkThisWeek: false }), "Morning pumped", "Lana: a pump logged, an empty fridge, no bottle since yesterday noon");
  assert.equal(defaultMilk({ ...none, inStock: true }), "Morning pumped");
  assert.equal(defaultMilk({ ...none, namedMilkThisWeek: true }), "Morning pumped");
  assert.equal(defaultMilk(none), null, "a home that never pumped is not told it gave pumped milk");
  assert.equal(defaultMilk({ ...none, lastMilk: "  " }), null);
});

// ---- logged lately, the strip, the Feeds and Food cards (R8) ------------------------------------------

test("logged lately: today or the 6 calendar days before it, on the home's calendar, turning at local midnight", () => {
  // 00:00 on 11 November in Dubai is 20:00 on 10 November in UTC.
  assert.equal(loggedLately(iso(at(-6, "00:00")), TODAY, TZ), true);
  assert.equal(loggedLately(iso(at(-7, "23:59")), TODAY, TZ), false);
  assert.equal(loggedLately(iso(at(-6, "00:00")), TODAY, "UTC"), false, "the same instant is 10 November in UTC");
  assert.equal(loggedLately(iso(at(0, "00:00")), TODAY, TZ), true);
  assert.equal(loggedLately(iso(at(-6, "00:00")), ymd(1), TZ), false, "a day later it has dropped out");
  assert.deepEqual([loggedLately(null, TODAY, TZ), loggedLately(iso(at(1, "08:00")), TODAY, TZ), loggedLately("not a time", TODAY, TZ)], [false, false, false]);
  const kinds = kindsLoggedLately(readAt([bottle(at(-8, "09:00"), 120), diaper(at(-6, "00:00")), meal(at(0, "08:00"))], at(0, "13:00"), 14), TODAY, TZ);
  assert.deepEqual([...kinds].sort(), ["lana.diaper", "lana.meal"]);
});

const strip = (over: Partial<Parameters<typeof stripCells>[0]>) =>
  stripCells({ stage: stageOf(746), woke: "07:00", naps: 0, napExpected: true, feeds: 0, diapers: 0, lastFeedAt: null, lastDiaperAt: null, today: TODAY, tz: TZ, ...over })?.map((c) => `${c.value} ${c.label}`) ?? null;

test("the strip from 12 months: cells only for what the family logs; fewer than two, no strip", () => {
  assert.deepEqual(strip({ stage: stageOf(120), napExpected: false }), ["07:00 woke", "0 of 3–4 naps", "0 feeds", "0 diapers"], "a baby: the four cells as on main");
  assert.deepEqual(stripCells({ stage: stageOf(120), woke: "07:00", naps: 0, napExpected: false, feeds: 0, diapers: 0, lastFeedAt: null, lastDiaperAt: null, today: TODAY, tz: TZ })?.map((c) => c.kind), ["woke", "naps", "feeds", "diapers"], "each cell names its kind: Home's strip links naps and feeds by it and leaves woke to the card below");
  assert.deepEqual(strip({}), ["07:00 woke", "0 naps"]);
  assert.deepEqual(strip({ naps: 1 }), ["07:00 woke", "1 nap"]);
  assert.deepEqual(strip({ naps: 2 }), ["07:00 woke", "2 naps"]);
  assert.deepEqual(strip({ napExpected: false }), null, "no nap expected and nothing else logged: no strip");
  assert.deepEqual(strip({ napExpected: false, naps: 1 }), ["07:00 woke", "1 nap"], "a nap had today shows even when none was expected");
  assert.deepEqual(strip({ napExpected: false, diapers: 0, lastDiaperAt: iso(at(-1, "19:45")) }), ["07:00 woke", "0 diapers"]);
  assert.deepEqual(strip({ stage: stageOf(563), naps: 1, diapers: 2, lastDiaperAt: iso(at(0, "10:30")), feeds: 1, lastFeedAt: iso(at(0, "07:00")) }), ["07:00 woke", "1 of 1 naps", "1 feed", "2 diapers"]);
  assert.deepEqual(strip({ stage: stageOf(380), lastFeedAt: iso(at(-7, "18:45")), lastDiaperAt: iso(at(-6, "07:05")) }), ["07:00 woke", "0 of 1–2 naps", "0 diapers"], "a bottle 7 days ago is not lately");
});

const card = (over: Partial<Parameters<typeof feedCard>[0]>) => feedCard({ ageDays: 380, feeding: false, nextDue: null, todayFeeds: [], lastFeedAt: null, today: TODAY, tz: TZ, now: msOf(at(0, "20:00")), ...over });

test("the Feeds card from 12 months: the day's sum and the last time; never 'yet', 'due' or 'usual'", () => {
  const b180 = { payload: { method: "Bottle", amount_ml: 180 } };
  const cases = [
    card({ feeding: true, todayFeeds: [{ payload: { method: "Breast" } }], lastFeedAt: iso(at(0, "19:50")) }),
    card({ todayFeeds: [b180], lastFeedAt: iso(at(0, "18:40")) }),
    card({ todayFeeds: [{ payload: { method: "Breast" } }, { payload: { method: "Breast" } }], lastFeedAt: iso(at(0, "18:40")) }),
    card({ todayFeeds: [b180, { payload: { method: "Breast" } }], lastFeedAt: iso(at(0, "18:40")) }),
    card({ todayFeeds: [{ payload: { method: "Bottle" } }], lastFeedAt: iso(at(0, "08:00")) }),
    card({ lastFeedAt: iso(at(-1, "18:40")) }),
    card({ lastFeedAt: iso(at(-3, "18:40")) }),
    card({ lastFeedAt: iso(at(-7, "18:40")) }),
    card({ nextDue: iso(at(0, "10:00")), lastFeedAt: iso(at(-1, "18:40")) }),
  ];
  assert.deepEqual(cases.map((c) => [c.show, c.headline, c.line]), [
    [true, "Feeding now", "1 breastfeed"],
    [true, "180 ml in 1 bottle", "Last at 18:40."],
    [true, "2 breastfeeds", "Last at 18:40."],
    [true, "180 ml in 1 bottle · 1 breastfeed", "Last at 18:40."],
    [true, "1 bottle", "Last at 08:00."],
    [true, "None today", "Last: yesterday 18:40."],
    [true, "None today", "Last: Saturday 18:40."],
    [false, "None today", "Last: Tuesday 18:40."],
    [true, "None today", "Last: yesterday 18:40."],
  ]);
  for (const c of cases) assert.ok(!/\b(yet|due|usual)\b/i.test(`${c.headline} ${c.line}`) && c.usual === null, c.headline);
});

test("the Feeds card for a baby, as on main", () => {
  const now = msOf(at(0, "13:00"));
  assert.deepEqual(card({ ageDays: 365, now, nextDue: iso(at(0, "12:30")) }), { show: true, headline: "Feed due now", line: "Nothing yet today.", usual: "Usual at this age: 4 to 6 feeds a day." });
  assert.equal(card({ ageDays: 165, now, nextDue: iso(at(0, "15:10")) }).headline, "Next feed about 15:10");
  assert.deepEqual(card({ ageDays: null, now, todayFeeds: [{ payload: { method: "Bottle", amount_ml: 120 } }] }), { show: true, headline: "No feed logged yet", line: "120 ml in 1 bottle", usual: null });
  assert.equal(card({ ageDays: 365, now, feeding: true }).headline, "Feeding now");
});

test("the Food card's headline: the count alone from 12 months", () => {
  assert.deepEqual(foodHeadline(stageOf(200), 2), { count: "2 meals", usual: "usually 1–2 a day" });
  assert.deepEqual(foodHeadline(stageOf(365), 0), { count: "No meal yet", usual: "usually 2–3 a day" });
  assert.deepEqual(foodHeadline(stageOf(366), 4), { count: "4 meals", usual: null });
  assert.deepEqual(foodHeadline(stageOf(1111), 1), { count: "1 meal", usual: null });
});

// ---- the day's rhythm (R2, R11) -------------------------------------------------------------------------

test("a toddler's day rhythm: 'wake', not 'wake and feed', and no more naps than the pattern", () => {
  const words = (s: ReturnType<typeof daySchedule>) => s.lines.map((l) => `${l.at} ${l.what}`);
  assert.deepEqual(words(daySchedule(7 * 60, 563, null, 1)), ["07:00 wake", "12:30 nap (about 75 min)", "13:45 wake", "18:45 bedtime routine", "19:15 asleep for the night"]);
  assert.deepEqual(words(daySchedule(7 * 60, 380, null, 2)), ["07:00 wake", "10:30 nap (about 75 min)", "11:45 wake", "15:15 nap (about 75 min)", "16:30 wake", "19:30 bedtime routine", "20:00 asleep for the night"]);
  assert.deepEqual(words(daySchedule(7 * 60, 913, null, 0)), ["07:00 wake", "18:00 bedtime routine", "18:30 asleep for the night"], "no nap expected: none planned");
  assert.ok(!words(daySchedule(6 * 60, 1111, null, null)).some((l) => /feed/.test(l)));
  assert.equal(daySchedule(7 * 60, 365, null, 0).lines[0].what, "wake and feed", "day 365: a baby's rhythm, the pattern not read");
  assert.equal(daySchedule(7 * 60, 365, null, 0).lines.filter((l) => l.what.startsWith("nap")).length, 2);
});

test("every day edge: a baby on one side, a toddler on the other, with nothing in between", () => {
  for (const d of EDGES) {
    const t = isToddler(d);
    assert.equal(stageOf(d).toddler, t);
    assert.equal(normsForAge(d).feeds === null, t, `norms at ${d}`);
    assert.equal(topicsFor(d)[0].normal === "", t, `topics at ${d}`);
    assert.equal(pumpingActive(null, 0, d), !t, `pumping at ${d}`);
    assert.equal(checkEntries([mk("sleep", 0, 11 * 60)], { now: NOW, ageDays: d }).length === 0, t, `checks at ${d}`);
    assert.equal(tipsFor([], bornAgo(d), msOf(at(0, "13:00")), { timezone: TZ }).length === 0, t, `tips at ${d}`);
  }
});
