/**
 * What Home says to a toddler's family over whole days, through the library's own functions
 * (lib/fixtures/toddler-days.ts calls them as app/(app)/page.tsx does): the top card, the
 * strip and the Feeds card at 07:00, 10:00, 13:00, 16:00 and 20:00 for WALK.md's four
 * families, and the days that test the nap rules (R5). The rules one by one are in
 * lib/toddler.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { napPattern, nextNap } from "./child-insights.ts";
import { at, bornAgo, everyDay, FAMILIES, familyLog, homeAt, hourOf, meal, msOf, readAt, sleep, TZ, type Draft, type Row } from "./fixtures/toddler-days.ts";

const HOURS = ["07:00", "10:00", "13:00", "16:00", "20:00"];
/** One line per hour: the card | the strip | the Feeds card (or "no feed card"). */
const walk = (child: { ageDays: number; sex: string | null; name: string }, log: Draft[], hours = HOURS) =>
  hours.map((hh) => {
    const v = homeAt(child, log, at(0, hh));
    return `${hh} ${v.card} | ${v.strip} | ${v.feeds.show ? `${v.feeds.headline} ${v.feeds.line}` : "no feed card"}`;
  });

test("Noor, 12 months, two naps and two bottles: the nap windows, bedtime after the second nap, her bottles", () => {
  const f = FAMILIES.noor;
  assert.deepEqual(walk(f, familyLog(f)), [
    "07:00 Next nap 10:00 – 10:30, up since 06:45. In 3 h. Start winding down. | 06:45 woke · 0 of 1–2 naps · 1 feed · 0 diapers | 180 ml in 1 bottle Last at 07:00.",
    "10:00 Asleep since 09:45 | 06:45 woke · 1 of 1–2 naps · 1 feed · 1 diaper | 180 ml in 1 bottle Last at 07:00.",
    "13:00 Next nap 14:15 – 14:45, up since 11:00. In 1 h 15 min. Start winding down. | 06:45 woke · 1 of 1–2 naps · 1 feed · 2 diapers | 180 ml in 1 bottle Last at 07:00.",
    "16:00 Bedtime 19:00 – 19:30, up since 15:45. In 3 h. Start winding down. | 06:45 woke · 2 of 1–2 naps · 1 feed · 3 diapers | 180 ml in 1 bottle Last at 07:00.",
    "20:00 Asleep since 19:30 | 06:45 woke · 2 of 1–2 naps · 2 feeds · 4 diapers | 380 ml in 2 bottles Last at 18:45.",
  ]);
});

test("Adam, 18 months, one nap and no bottle: no feeds cell and no Feeds card; bedtime after the nap", () => {
  const f = FAMILIES.adam;
  assert.deepEqual(walk(f, familyLog(f)), [
    "07:00 Next nap 12:15 – 12:45, up since 07:00. In 5 h 15 min. Start winding down. | 07:00 woke · 0 of 1 naps · 0 diapers | no feed card",
    "10:00 Next nap 12:15 – 12:45, up since 07:00. In 2 h 15 min. Start winding down. | 07:00 woke · 0 of 1 naps · 1 diaper | no feed card",
    "13:00 Asleep since 12:30 | 07:00 woke · 1 of 1 naps · 2 diapers | no feed card",
    "16:00 Bedtime 19:45 – 20:15, up since 14:30. In 3 h 45 min. Start winding down. | 07:00 woke · 1 of 1 naps · 3 diapers | no feed card",
    "20:00 Asleep since 19:45 | 07:00 woke · 1 of 1 naps · 4 diapers | no feed card",
  ]);
});

test("Maya, 24 months, one nap: the nap as a plain count", () => {
  const f = FAMILIES.maya;
  assert.deepEqual(walk(f, familyLog(f)), [
    "07:00 Next nap 12:45 – 13:15, up since 07:00. In 5 h 45 min. Start winding down. | 07:00 woke · 0 naps · 0 diapers | no feed card",
    "10:00 Next nap 12:45 – 13:15, up since 07:00. In 2 h 45 min. Start winding down. | 07:00 woke · 0 naps · 1 diaper | no feed card",
    // The nap starts on the minute: the strip counts it from the next.
    "13:00 Asleep since 13:00 | 07:00 woke · 0 naps · 1 diaper | no feed card",
    "16:00 Bedtime 20:15 – 20:45, up since 14:30. In 4 h 15 min. Start winding down. | 07:00 woke · 1 nap · 2 diapers | no feed card",
    "20:00 Asleep since 20:00 | 07:00 woke · 1 nap · 3 diapers | no feed card",
  ]);
});

test("Yusuf, 36 months, no nap and no diapers: 'Awake for' all day, no window, no strip, no Feeds card", () => {
  const f = FAMILIES.yusuf;
  assert.deepEqual(walk(f, familyLog(f)), [
    "07:00 Awake for 0 min, since 07:00 | no strip | no feed card",
    "10:00 Awake for 3 h, since 07:00 | no strip | no feed card",
    "13:00 Awake for 6 h, since 07:00 | no strip | no feed card",
    "16:00 Awake for 9 h, since 07:00 | no strip | no feed card",
    "20:00 Asleep since 19:45 | no strip | no feed card",
  ]);
  const v = homeAt(f, familyLog(f), at(0, "16:00"));
  assert.deepEqual([v.pattern.expected, v.pattern.perDay, v.nap?.at, v.nap?.awakeMin], [false, 0, null, 540]);
});

test("none of the four days says a thing the family does not do: no due, no 'yet', no zero feeds, no tip, nothing to check", () => {
  for (const f of Object.values(FAMILIES)) {
    for (const hh of HOURS) {
      const v = homeAt(f, familyLog(f), at(0, hh));
      const said = `${v.card} ${v.strip} ${v.feeds.show ? `${v.feeds.headline} ${v.feeds.line}` : ""}`;
      assert.ok(!/due|yet|0 feeds|usual|Past the window|napped since/i.test(said), `${f.name} at ${hh}: ${said}`);
      assert.deepEqual([v.tips, v.checks], [[], []], `${f.name} at ${hh}`);
    }
  }
});

// ---- the nap rules (R5) -------------------------------------------------------------------------

/** Nights from 19:30 to 07:00, each on the morning it ends: nights(-6) starts 7 evenings ago and ends this morning. */
const nights = (from: number, to = 0): Draft[] => everyDay([["sleep", -1, "19:30", 0, "07:00", {}]] as Row[], from, to);
const pattern = (ageDays: number, log: Draft[], hh = "10:00") => {
  const now = msOf(at(0, hh));
  return napPattern(readAt(log, at(0, hh)), ageDays, now, TZ, now - 7 * 86_400_000);
};

test("day two of a new home (one evening, one night): a nap is expected under 3 years, by the age", () => {
  const log = [meal(at(-1, "18:00")), sleep(at(-1, "19:45"), at(0, "07:00"))];
  const p = pattern(913, log);
  assert.deepEqual([p.toddler, p.evidenceDays, p.napDays, p.expected, p.perDay], [true, 1, 0, true, 1]);
  assert.deepEqual(walk({ ageDays: 913, sex: "Boy", name: "Omar" }, log, ["07:00", "13:00"]), [
    "07:00 Next nap 12:30 – 13:00, up since 07:00. In 5 h 30 min. Start winding down. | 07:00 woke · 0 naps | no feed card",
    "13:00 Next nap 12:30 – 13:00, up since 07:00. Now. Start winding down. | 07:00 woke · 0 naps | no feed card",
  ]);
  // From 3 years, nothing to go by means no nap.
  assert.deepEqual([pattern(1096, log).expected, pattern(1095, log).expected], [false, true]);
  // At 12 months the default is two naps, from 15 months one.
  assert.deepEqual([pattern(456, log).perDay, pattern(457, log).perDay], [2, 1]);
});

test("a 30-month-old with no nap: no window, no strip, and 'Awake for' still at 12 h 30 min; nothing after 16 hours", () => {
  // Nights from 19:30 to 07:00 up to this morning; tonight's has not started.
  const log = [...nights(-7), ...everyDay([["meal", 0, "08:00", null, null, {}]] as Row[], -7, 0)];
  const p = pattern(913, log);
  assert.deepEqual([p.evidenceDays, p.napDays, p.expected, p.perDay], [6, 0, false, 0]);
  const sara = { ageDays: 913, sex: "Girl", name: "Sara" };
  assert.deepEqual(walk(sara, log, ["13:00", "19:30", "23:00", "23:01"]), [
    "13:00 Awake for 6 h, since 07:00 | no strip | no feed card",
    "19:30 Awake for 12 h 30 min, since 07:00 | no strip | no feed card",
    "23:00 Awake for 16 h, since 07:00 | no strip | no feed card",
    "23:01 Tap below, or tell me what happened. | no strip | no feed card",
  ]);
  // A baby's card gives up after 12 hours, as on main.
  assert.equal(homeAt({ ageDays: 365, sex: "Girl", name: "Sara" }, log, at(0, "19:30")).card, "Tap below, or tell me what happened.");
  // A nap logged today after all: it shows on the strip, and the card goes by the nap.
  const napped = [...log, sleep(at(0, "13:00"), at(0, "14:00"))];
  assert.equal(homeAt(sara, napped, at(0, "16:00")).strip, "07:00 woke · 1 nap");
});

test("a child who naps on 4 days in 7 is expected to nap, once; on 2 days in 6 is not; half the days is enough", () => {
  const naps = (days: number[]) => days.map((d) => sleep(at(d, "13:00"), at(d, "14:30")));
  const four = pattern(913, [...nights(-6), ...naps([-6, -4, -3, -1])]);
  assert.deepEqual([four.evidenceDays, four.napDays, four.expected, four.perDay], [6, 4, true, 1]);
  const two = pattern(913, [...nights(-6), ...naps([-6, -3])]);
  assert.deepEqual([two.napDays, two.expected, two.perDay], [2, false, 0]);
  const half = pattern(913, [...nights(-3), ...naps([-4, -2])]);
  assert.deepEqual([half.evidenceDays, half.napDays, half.expected], [4, 2, true]);
  const three = pattern(1111, [...nights(-6), ...naps([-6, -5, -1])]);
  assert.deepEqual([three.napDays, three.expected], [3, true], "3 nap days is enough at any age");
  // Two naps a day on most days: two.
  const twice = pattern(400, [...nights(-6), ...[-6, -5, -4, -3, -2, -1].flatMap((d) => [sleep(at(d, "09:30"), at(d, "10:30")), sleep(at(d, "14:00"), at(d, "15:00"))])]);
  assert.deepEqual([twice.perDay, twice.expected], [2, true]);
});

test("what counts: whole days inside what was fetched, naps from 07:00 to before 18:00 and under 4 hours", () => {
  // A nap at 06:59, one at 18:00, one of 4 hours and one the day before the fetched week: none is a nap day.
  const log = [...nights(-8), sleep(at(-5, "06:59"), at(-5, "07:30")), sleep(at(-4, "18:00"), at(-4, "18:30")), sleep(at(-3, "11:00"), at(-3, "15:00")), sleep(at(-7, "12:00"), at(-7, "13:00"))];
  const p = pattern(913, log, "10:00");
  assert.deepEqual([p.evidenceDays, p.napDays], [6, 0]);
  const ok = pattern(913, [...nights(-6), sleep(at(-3, "07:00"), at(-3, "10:59"))]);
  assert.equal(ok.napDays, 1);
  // A baby: the pattern is not read, and always expects a nap.
  assert.deepEqual([pattern(365, nights(-6)).expected, pattern(365, nights(-6)).perDay], [true, null]);
});

test("once today's naps reach the pattern's count the next window is bedtime, whatever the hour", () => {
  // Two naps a day at 13 months; today both are done by 11:00.
  const days = [-6, -5, -4, -3, -2, -1, 0].flatMap((d) => [sleep(at(d, "08:00"), at(d, "08:45")), sleep(at(d, "10:00"), at(d, "11:00"))]);
  const log = [...nights(-6), ...days];
  const now = msOf(at(0, "11:30"));
  const week = readAt(log, at(0, "11:30"));
  const p = napPattern(week, 400, now, TZ, now - 7 * 86_400_000);
  assert.deepEqual([p.perDay, p.napsToday], [2, 2]);
  const n = nextNap(week, 400, now, hourOf, p)!;
  assert.equal(n.isBedtime, true);
  assert.ok(n.at! < msOf(at(0, "18:30")), "an early window, still called bedtime");
  // The same day for a baby: a nap, by the hour.
  assert.equal(nextNap(week, 365, now, hourOf, p)!.isBedtime, false);
});

// ---- Lana, on the day she turns one (6 June 2027) ---------------------------------------------------

/** Lana's day as the demo home logs it (supabase/tests/demo_data.sql), with her morning pump. */
const LANA: Row[] = [
  ["sleep", -1, "19:50", 0, "00:55", {}], ["feed", 0, "01:00", 0, "01:18", { method: "Breast", side: "Right", duration_min: 18 }], ["sleep", 0, "01:25", 0, "06:10", {}],
  ["feed", 0, "06:30", 0, "06:52", { method: "Breast", side: "Left", duration_min: 22 }], ["diaper", 0, "07:05", null, null, { kind: "Both" }], ["pump", 0, "07:30", null, null, { amount_ml: 120 }],
  ["sleep", 0, "08:30", 0, "09:40", {}], ["feed", 0, "09:50", 0, "10:05", { method: "Bottle", amount_ml: 120, milk: "Fridge" }], ["diaper", 0, "10:10", null, null, { kind: "Wet" }],
  ["sleep", 0, "11:35", 0, "12:50", {}], ["diaper", 0, "13:05", null, null, { kind: "Dirty" }], ["feed", 0, "13:10", 0, "13:25", { method: "Bottle", amount_ml: 130, milk: "Fridge" }],
  ["sleep", 0, "14:30", 0, "15:35", {}], ["feed", 0, "16:00", 0, "16:15", { method: "Bottle", amount_ml: 120, milk: "Fridge" }], ["diaper", 0, "16:20", null, null, { kind: "Wet" }],
  ["feed", 0, "18:20", 0, "18:45", { method: "Breast", side: "Right", duration_min: 25 }], ["diaper", 0, "19:30", null, null, { kind: "Both" }], ["feed", 0, "21:30", 0, "21:45", { method: "Bottle", amount_ml: 150, milk: "Fridge" }],
];
const lanaLog = everyDay(LANA, -13, 1).filter((d) => d.start < at(1, "00:00"));
const lana = (ageDays: number) => ({ ageDays, sex: "Girl", name: "Lana" });

test("Lana's own log at 365 days: a baby's Home, as on main", () => {
  assert.deepEqual(walk(lana(365), lanaLog, ["07:00", "13:00", "16:00"]), [
    "07:00 Next nap 08:10 – 08:40, up since 06:10. In 1 h 10 min. Start winding down. | 06:10 woke · 0 of 2 naps · 2 feeds · 0 diapers | Next feed about 10:52 2 breastfeeds",
    "13:00 Next nap 14:50 – 15:20, up since 12:50. In 1 h 50 min. Start winding down. | 06:10 woke · 2 of 2 naps · 3 feeds · 2 diapers | Next feed about 14:05 120 ml in 1 bottle · 2 breastfeeds",
    "16:00 Next nap 17:35 – 18:05, up since 15:35. In 1 h 35 min. Start winding down. | 06:10 woke · 3 of 2 naps · 5 feeds · 3 diapers | Next feed about 20:00 370 ml in 3 bottles · 2 breastfeeds",
  ]);
  assert.deepEqual(homeAt(lana(365), lanaLog, at(0, "07:00")).tips.map((t) => t.title), ["4 wet diapers in 24 h", "No diaper for 11 h 30 min"]);
});

test("Lana's own log at 366 days: what changes on 6 June 2027", () => {
  assert.deepEqual(walk(lana(366), lanaLog, ["07:00", "13:00", "16:00"]), [
    // Her own rhythm, held inside a two-nap toddler's window (3 to 4 hours, less 15 minutes): later than at 365.
    "07:00 Next nap 08:40 – 09:10, up since 06:10. In 1 h 40 min. Start winding down. | 06:10 woke · 0 of 1–2 naps · 2 feeds · 0 diapers | 2 breastfeeds Last at 06:30.",
    // Her log shows three naps a day: the window is a two-nap toddler's, but bedtime waits for the third nap.
    "13:00 Next nap 15:20 – 15:50, up since 12:50. In 2 h 20 min. Start winding down. | 06:10 woke · 2 of 1–2 naps · 3 feeds · 2 diapers | 120 ml in 1 bottle · 2 breastfeeds Last at 09:50.",
    "16:00 Bedtime 18:05 – 18:35, up since 15:35. In 2 h 5 min. Start winding down. | 06:10 woke · 3 of 1–2 naps · 5 feeds · 3 diapers | 370 ml in 3 bottles · 2 breastfeeds Last at 16:00.",
  ]);
  const before = homeAt(lana(365), lanaLog, at(0, "07:00"));
  const after = homeAt(lana(366), lanaLog, at(0, "07:00"));
  assert.deepEqual(after.tips, [], "the guide falls silent");
  assert.deepEqual(after.checks.map((c) => c.title), before.checks.map((c) => c.title), "the checks do not move: her bottles are under 240 ml, her nights split at 01:00");
  assert.equal(after.checks.length, 7, "the 21:30 bottle inside each evening's sleep is still a sign the timer ran on");
  assert.deepEqual([after.pattern.expected, after.pattern.perDay, after.pattern.napDays], [true, 2, 6]);
  assert.equal(bornAgo(366), "2025-11-16");
});
