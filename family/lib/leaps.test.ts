import { test } from "node:test";
import assert from "node:assert/strict";
import { BANDS, leapWeek, startsIn, stretchHref, stretchNav } from "./leaps.ts";

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

test("the stretch the screen shows: the child's own unless the address names one", () => {
  const five = stretchNav(undefined, 24 * 7); // week 24: "Five months"
  assert.equal(BANDS[five.index].fromWeek, 21);
  assert.deepEqual([five.current, five.home, five.prev, five.next], [five.index, five.index, five.index - 1, five.index + 1]);
  const six = stretchNav("26", 24 * 7);
  assert.equal(BANDS[six.index].fromWeek, 26);
  assert.equal(six.current, five.index, "she is still in her own stretch while another is read");
  assert.equal(stretchNav(["26", "0"], 24 * 7).index, six.index, "two values: the first");
  assert.deepEqual([stretchNav("0", 24 * 7).prev, stretchNav("131", 24 * 7).next], [null, null], "no arrow past either end");
});

test("anything else in the address is the stretch it opens on", () => {
  const home = stretchNav(undefined, 24 * 7).index;
  for (const bad of ["22", "25", "157", "9999", "-1", "26.0", "six", "", " 26", "0x1a", "../baby"]) assert.equal(stretchNav(bad, 24 * 7).index, home, JSON.stringify(bad));
});

test("no birth date opens on the first stretch, past three years on the last, and neither marks one as hers", () => {
  assert.deepEqual(stretchNav(undefined, null), { index: 0, current: null, home: 0, behind: 0, prev: null, next: 1 });
  const last = BANDS.length - 1;
  assert.deepEqual(stretchNav(undefined, 1111), { index: last, current: null, home: last, behind: BANDS.length, prev: last - 1, next: null }, "past three years every stretch is behind her");
  assert.deepEqual([stretchNav(undefined, 156 * 7 + 6).behind, stretchNav(undefined, 157 * 7).behind], [last, BANDS.length], "the last day of the calendar, and the first day past it");
  assert.equal(stretchNav("0", 24 * 7).behind, stretchNav(undefined, 24 * 7).current, "what is behind her does not move with the card that is open");
  assert.equal(stretchNav("26", null).current, null);
  assert.equal(stretchNav(undefined, 0).current, 0, "the day she is born is the first week");
});

test("a stretch's address, and how far off it is", () => {
  const nav = stretchNav(undefined, 24 * 7);
  assert.equal(stretchHref(nav.index, nav.home), "/baby/weeks");
  assert.equal(stretchHref(nav.next, nav.home), "/baby/weeks?stretch=26");
  assert.equal(stretchHref(0, nav.home), "/baby/weeks?stretch=0");
  assert.equal(stretchHref(null, nav.home), null);
  assert.deepEqual([1, 2, 12, 13, 26, 100, 104, 113].map(startsIn), ["starts next week", "starts in 2 weeks", "starts in 12 weeks", "in about 3 months", "in about 6 months", "in about 23 months", "in about 2 years", "in about 2 years"]);
  // The last stretch begins at two and a half years: a newborn reads that, not "3 years", over the title "Two and a half to three".
  assert.deepEqual([128, 129, 130, 131].map(startsIn), ["in about 2 and a half years", "in about 2 and a half years", "in about 2 and a half years", "in about 2 and a half years"]);
  // Every pair the screen can show: a child in any week, any later stretch. None says a whole number of years it is not near.
  for (let week = 0; week <= 156; week++) for (const b of BANDS) if (b.fromWeek > week) assert.match(startsIn(b.fromWeek - week), /^(starts next week|starts in \d+ weeks|in about \d+ months|in about 2 years|in about 2 and a half years)$/, `${week} to ${b.fromWeek}`);
});
