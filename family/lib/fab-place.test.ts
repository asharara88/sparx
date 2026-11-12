import { test } from "node:test";
import assert from "node:assert/strict";
import { fabLift } from "./fab-place.ts";

// The button: 56 px round, its bottom at 770 (above the tab bar), on the right.
const fab = { top: 714, bottom: 770, left: 318, right: 374 };
const box = (top: number, bottom: number, left = 300, right = 380) => ({ top, bottom, left, right });

test("nothing under it: it stays home", () => {
  assert.equal(fabLift(fab, [], 160), 0);
  assert.equal(fabLift(fab, [box(500, 540)], 160), 0); // far above
  assert.equal(fabLift(fab, [box(720, 760, 20, 200)], 160), 0); // beside it, on the left
});

test("an amount under it: it slides just clear of it", () => {
  // "180 ml" from 740 to 760: the button's bottom must rise above 740 - 6.
  assert.equal(fabLift(fab, [box(740, 760)], 160), 770 - 740 + 6);
});

test("two rows: it lands in the gap between them when the gap is big enough", () => {
  // rows at 600-640 and 720-760: the gap 640-720 holds 56 + 2 * 6.
  assert.equal(fabLift(fab, [box(600, 640), box(720, 760)], 160), 770 - 720 + 6);
});

test("a gap too small: it goes on above the next thing", () => {
  // rows at 660-700 and 720-760: the 20 px gap is too small; it clears 660.
  assert.equal(fabLift(fab, [box(660, 700), box(720, 760)], 160), 770 - 660 + 6);
});

test("no clear spot in reach: it stays home rather than wander", () => {
  const list = Array.from({ length: 10 }, (_, i) => box(480 + i * 30, 504 + i * 30));
  assert.equal(fabLift(fab, list, 160), 0);
});
