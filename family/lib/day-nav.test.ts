import { test } from "node:test";
import assert from "node:assert/strict";
import { dayHref, dayNav } from "./day-nav.ts";

const TODAY = "2026-11-24";

test("the day a section shows: today unless the address names one of the six days before", () => {
  assert.deepEqual(dayNav(undefined, TODAY), { day: TODAY, isToday: true, prev: "2026-11-23", next: null });
  assert.deepEqual(dayNav("2026-11-23", TODAY), { day: "2026-11-23", isToday: false, prev: "2026-11-22", next: TODAY });
  assert.deepEqual(dayNav("2026-11-18", TODAY), { day: "2026-11-18", isToday: false, prev: null, next: "2026-11-19" }, "the first day has no day before");
  assert.deepEqual(dayNav(["2026-11-20", "2026-11-21"], TODAY).day, "2026-11-20", "two values: the first");
});

test("anything else in the address is today", () => {
  for (const bad of ["2026-11-17", "2026-11-25", "2027-01-01", "yesterday", "", "2026-11-31", "2026-13-01", "2026-11-2", "2026-11-23T00:00", "../baby"]) {
    assert.equal(dayNav(bad, TODAY).day, TODAY, bad);
  }
});

test("a month's and a year's edge", () => {
  assert.deepEqual(dayNav("2026-12-30", "2027-01-02"), { day: "2026-12-30", isToday: false, prev: "2026-12-29", next: "2026-12-31" });
  assert.equal(dayNav("2026-02-29", "2026-03-02").day, "2026-03-02", "not a day in 2026");
  assert.equal(dayNav("2028-02-29", "2028-03-02").day, "2028-02-29");
});

test("a section's address on a day", () => {
  assert.equal(dayHref("/baby/feed", TODAY, TODAY), "/baby/feed");
  assert.equal(dayHref("/baby/feed", "2026-11-23", TODAY), "/baby/feed?day=2026-11-23");
  assert.equal(dayHref("/baby/sleep", null, TODAY), null);
});
