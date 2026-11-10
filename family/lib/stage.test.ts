import { test } from "node:test";
import assert from "node:assert/strict";
import { ageInDays, awakeWindow, feedGapFor, feedLateMin, range, stageFor, stageOf, SOLIDS_FROM_DAYS } from "./stage.ts";

test("under 6 months nothing moves: the awake windows, the 3 h feed gap and the 4 h / 5 h late feed are as before", () => {
  assert.deepEqual([41, 42, 83, 84, 119, 120, 154, 179].map(awakeWindow), [[45, 60], [60, 90], [60, 90], [75, 120], [75, 120], [105, 150], [105, 150], [105, 150]]);
  const lana = stageOf(154);
  assert.equal(lana.band, "3-6");
  assert.equal(lana.feedEveryMin, 180);
  assert.deepEqual(feedLateMin(lana), [240, 300]);
  assert.equal(feedGapFor(lana, 180), 180);
  assert.equal(lana.solids, false);
  assert.equal(lana.meals, null);
});

test("the stages after 6 months: longer awake, fewer naps, longer feed gaps, meals", () => {
  const s7 = stageOf(214); // 7 months
  assert.equal(s7.band, "6-9");
  assert.deepEqual(s7.awake, [120, 180]);
  assert.equal(range(s7.naps), "2–3");
  assert.equal(feedGapFor(s7, 180), 240, "the stage's longer gap wins over the type's 180");
  assert.deepEqual(s7.meals, [1, 2]);
  assert.equal(stageOf(305).band, "9-12");
  assert.deepEqual(stageOf(305).awake, [150, 210]);
  assert.equal(range(stageOf(305).naps), "2");
  assert.equal(stageOf(400).band, "12-18");
  assert.equal(stageOf(600).band, "18-24");
  assert.deepEqual(stageOf(600).awake, [300, 360]);
  assert.equal(stageOf(800).band, "24+");
  assert.ok(stageOf(400).awake[1] > stageOf(305).awake[1], "awake time keeps growing past 6 months");
});

test("meals from 24 weeks, so a family starting a little early can log", () => {
  assert.equal(stageOf(SOLIDS_FROM_DAYS - 1).solids, false);
  assert.equal(stageOf(SOLIDS_FROM_DAYS).solids, true);
  assert.deepEqual(stageOf(SOLIDS_FROM_DAYS).meals, [1, 1], "at 5½ months: one meal a day");
});

test("no birth date: the 120-day default the app has always assumed", () => {
  assert.equal(stageFor(null).band, "3-6");
  assert.equal(stageFor("2026-06-05", Date.parse("2026-11-06T12:00:00Z")).band, "3-6");
  assert.equal(stageFor("2026-01-05", Date.parse("2026-11-06T12:00:00Z")).band, "9-12");
});

test("the nap count says where the day is against what is usual, never an alarm", async () => {
  const { napsLine } = await import("./stage.ts");
  assert.equal(napsLine(2, [2, 3], true), "2 of 2–3 naps");
  assert.equal(napsLine(1, [2, 2], true), "1 of 2 naps");
  assert.equal(napsLine(4, [2, 3], true), "4 naps", "past the usual: just the count");
  assert.equal(napsLine(0, [2, 3], true), "no nap yet, usually 2–3");
  assert.equal(napsLine(1, [2, 3], false), "1 nap", "a past day: just the count");
  assert.equal(napsLine(0, [0, 1], true), "no nap yet");
});

test("age goes up at the home's midnight, not at UTC midnight", () => {
  // 02:30 on 10 Nov in Dubai is still 9 Nov in UTC.
  const at = Date.parse("2026-11-09T22:30:00Z");
  assert.equal(ageInDays("2026-05-26", at, "Asia/Dubai"), 168);
  assert.equal(ageInDays("2026-05-26", at, "UTC"), 167);
  assert.equal(ageInDays("2026-05-26", at), 167, "no zone given: UTC, as before");
  // The day she turns 24 weeks, solids start at midnight at home.
  assert.equal(stageFor("2026-05-26", at, "Asia/Dubai").solids, true);
  assert.equal(ageInDays(null, at, "Asia/Dubai"), null);
  assert.equal(ageInDays("2026-05-26T00:00:00Z", at, "Asia/Dubai"), 168, "a timestamp birth date reads as its day");
});
