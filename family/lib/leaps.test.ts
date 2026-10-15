import { test } from "node:test";
import assert from "node:assert/strict";
import { BANDS, leapWeek } from "./leaps.ts";

test("the bands cover weeks 0 to 156 with no gaps or overlaps", () => {
  let expectFrom = 0;
  for (const b of BANDS) {
    assert.equal(b.fromWeek, expectFrom, `band "${b.title}" starts at ${b.fromWeek}, expected ${expectFrom}`);
    assert.ok(b.toWeek >= b.fromWeek);
    assert.ok(b.expect.length > 40 && b.tip.length > 20 && b.source.length > 2, b.title);
    expectFrom = b.toWeek + 1;
  }
  assert.equal(expectFrom, 157);
});

test("leapWeek finds the stretch and counts to the next", () => {
  const w = leapWeek(130)!; // 18 weeks, 4 days
  assert.equal(w.week, 18);
  assert.equal(w.band.title, "The 4-month sleep change");
  assert.equal(w.weekInBand, 3);
  assert.equal(w.next?.fromWeek, 21);
  assert.equal(w.weeksToNext, 3);
  assert.equal(leapWeek(0)!.band.fromWeek, 0);
  assert.equal(leapWeek(156 * 7 + 6)!.band.toWeek, 156);
  assert.equal(leapWeek(157 * 7), null);
});
