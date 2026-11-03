import { test } from "node:test";
import assert from "node:assert/strict";
import { pumpSummary, todayVersusUsual } from "./pumping.ts";

const days = [
  { day: "2026-10-26", pump_ml: 300 },
  { day: "2026-10-27", pump_ml: 0 },
  { day: "2026-10-28", pump_ml: 420 },
  { day: "2026-10-29", pump_ml: 380 },
  { day: "2026-10-30", pump_ml: 0 },
  { day: "2026-10-31", pump_ml: 400 },
  { day: "2026-11-01", pump_ml: 360 },
  { day: "2026-11-02", pump_ml: 250 },
];

test("the usual day is the average of the week's pumping days, today left out", () => {
  const s = pumpSummary(days, "2026-11-02", 250);
  assert.equal(s.week.length, 7);
  assert.equal(s.week[0].day, "2026-10-26");
  assert.equal(s.week[6].day, "2026-11-01");
  assert.equal(s.pumpingDays, 5);
  assert.equal(s.averageMl, 372);
  assert.equal(s.maxMl, 420);
  assert.deepEqual(pumpSummary([], "2026-11-02", 0), { week: [], averageMl: 0, pumpingDays: 0, maxMl: 1 });
});

test("today against the usual day, in words", () => {
  assert.equal(todayVersusUsual(0, 0, 9), "Nothing pumped this week yet.");
  assert.equal(todayVersusUsual(120, 0, 9), "No usual day yet.");
  assert.equal(todayVersusUsual(400, 372, 20), "Already past a usual day (372 ml).");
  assert.equal(todayVersusUsual(250, 372, 12), "On track for a usual day (372 ml).");
  assert.equal(todayVersusUsual(100, 372, 20), "272 ml short of a usual day (372 ml).");
});
