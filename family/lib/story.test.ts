import { test } from "node:test";
import assert from "node:assert/strict";
import { addMonths, birthdayMonth, currentMonth, storyMonth } from "./story.ts";

test("addMonths keeps the day or clips to a short month", () => {
  assert.equal(addMonths("2026-06-05", 1), "2026-07-05");
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonths("2026-01-31", 3), "2026-04-30");
  assert.equal(addMonths("2026-11-15", 2), "2027-01-15");
});

test("storyMonth spans birthday to birthday and knows when it is still running", () => {
  const m1 = storyMonth("2026-06-05", 1, "2026-10-15")!;
  assert.deepEqual([m1.from, m1.to, m1.birthday, m1.inProgress], ["2026-06-05", "2026-07-04", "2026-07-05", false]);
  const m5 = storyMonth("2026-06-05", 5, "2026-10-15")!;
  assert.deepEqual([m5.from, m5.to, m5.birthday, m5.inProgress], ["2026-10-05", "2026-10-15", "2026-11-05", true]);
  assert.equal(storyMonth("2026-06-05", 6, "2026-10-15"), null);
  assert.equal(storyMonth("2026-06-05", 0, "2026-10-15"), null);
});

test("currentMonth and birthdayMonth", () => {
  assert.equal(currentMonth("2026-06-05", "2026-06-05"), 1);
  assert.equal(currentMonth("2026-06-05", "2026-07-04"), 1);
  assert.equal(currentMonth("2026-06-05", "2026-07-05"), 2);
  assert.equal(currentMonth("2026-06-05", "2026-10-15"), 5);
  assert.equal(birthdayMonth("2026-06-05", "2026-10-05"), 4);
  assert.equal(birthdayMonth("2026-06-05", "2026-10-15"), null);
  assert.equal(birthdayMonth("2026-06-05", "2026-06-05"), null);
});
