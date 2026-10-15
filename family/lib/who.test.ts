import { test } from "node:test";
import assert from "node:assert/strict";
import { GIRLS, MONTH_DAYS, percentileLabel, percentileOf, reference } from "./who.ts";

test("the curves rise and keep their order", () => {
  for (const kind of ["weight_kg", "length_cm", "head_cm"] as const) {
    const c = GIRLS[kind];
    assert.equal(c.months.length, c.p3.length);
    assert.equal(c.months.length, c.p97.length);
    for (let i = 0; i < c.months.length; i++) {
      assert.ok(c.p3[i] < c.p50[i] && c.p50[i] < c.p97[i], `${kind} at ${c.months[i]} months`);
      if (i) assert.ok(c.p50[i] > c.p50[i - 1], `${kind} median rises`);
    }
  }
});

test("reference interpolates between points and stops at 24 months", () => {
  const r6 = reference("weight_kg", 6 * MONTH_DAYS)!;
  assert.equal(Number(r6.p50.toFixed(1)), 7.3);
  const r45 = reference("length_cm", 4.5 * MONTH_DAYS)!;
  assert.ok(r45.p50 > 59.8 && r45.p50 < 65.7);
  assert.equal(reference("head_cm", 30 * MONTH_DAYS), null);
});

test("percentileOf puts the median at 50 and the 3rd at about 3", () => {
  const d = 4 * MONTH_DAYS;
  assert.equal(percentileOf("weight_kg", d, 6.4), 50);
  const low = percentileOf("weight_kg", d, 5.1)!;
  assert.ok(low >= 2 && low <= 4, String(low));
  const high = percentileOf("weight_kg", d, 8.1)!;
  assert.ok(high >= 96 && high <= 98, String(high));
  assert.equal(percentileOf("weight_kg", d, 0), null);
  assert.equal(percentileLabel(50), "about the 50th percentile");
  assert.equal(percentileLabel(42), "about the 42nd percentile");
  assert.equal(percentileLabel(2), "below the 3rd percentile");
});
