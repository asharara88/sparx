import { test } from "node:test";
import assert from "node:assert/strict";

const none = { days: 0, first_day: null, feeds: 0, breast_min: 0, pumps: 0, pump_ml: 0, diapers: 0, sleeps: 0, meals: 0 };

test("rows: one number each, in a fixed order, and nothing saved is left out, not shown as zero", async () => {
  const { effortRows } = await import("./effort.ts");
  assert.deepEqual(effortRows(none, "all"), []);
  assert.deepEqual(effortRows(none, "you"), []);
  assert.deepEqual(
    effortRows({ days: 173, first_day: "2026-06-05", feeds: 1240, breast_min: 8890, pumps: 412, pump_ml: 61350, diapers: 1904, sleeps: 380, meals: 0 }, "all"),
    [
      { label: "Days of care", value: "173" },
      { label: "Feeds", value: "1,240" },
      { label: "Hours at the breast", value: "148" },
      { label: "Litres pumped", value: "61" },
      { label: "Diapers", value: "1,904" },
      { label: "Times settled to sleep", value: "380" },
    ],
  );
  // Someone who neither breastfeeds nor pumps is not shown "0 hours" or "0 litres".
  assert.deepEqual(effortRows({ ...none, days: 40, feeds: 62, diapers: 88, meals: 3 }, "all").map((r) => r.label), ["Days of care", "Feeds", "Diapers", "Meals"]);
});

test("days are the home's row only: on one person's list a count with a ceiling would read as a score", async () => {
  const { effortRows } = await import("./effort.ts");
  const sum = { ...none, days: 9, feeds: 14, diapers: 30 };
  assert.deepEqual(effortRows(sum, "you").map((r) => r.label), ["Feeds", "Diapers"]);
  assert.deepEqual(effortRows(sum, "all").map((r) => r.label), ["Days of care", "Feeds", "Diapers"]);
  // Someone credited with days and nothing else has no list of their own.
  assert.deepEqual(effortRows({ ...none, days: 3 }, "you"), []);
});

test("hours and litres: whole hours rounded down, litres to a tenth under ten", async () => {
  const { effortRows } = await import("./effort.ts");
  const val = (s: object, label: string) => effortRows({ ...none, ...s }, "you").find((r) => r.label === label)?.value;
  assert.equal(val({ breast_min: 59 }, "Hours at the breast"), undefined);
  assert.equal(val({ breast_min: 60 }, "Hours at the breast"), "1");
  assert.equal(val({ breast_min: 119 }, "Hours at the breast"), "1");
  assert.equal(val({ pump_ml: 90 }, "Litres pumped"), undefined);
  assert.equal(val({ pump_ml: 150 }, "Litres pumped"), "0.2");
  assert.equal(val({ pump_ml: 4600 }, "Litres pumped"), "4.6");
  assert.equal(val({ pump_ml: 9000 }, "Litres pumped"), "9");
  assert.equal(val({ pump_ml: 12400 }, "Litres pumped"), "12");
});

test("no row carries more than one number, a target or a judgement", async () => {
  const { effortRows, effortLine } = await import("./effort.ts");
  const rows = effortRows({ days: 173, first_day: "2026-06-05", feeds: 1240, breast_min: 8890, pumps: 412, pump_ml: 61350, diapers: 1904, sleeps: 380, meals: 12 }, "all");
  for (const r of rows) {
    assert.doesNotMatch(r.label, /\d/);
    assert.doesNotMatch(`${r.label} ${r.value}`, /only|just|goal|target|left|more|missed|low|%|\//i);
  }
  for (const m of [1, 5, 12, 18, 24]) assert.doesNotMatch(effortLine(m, "Mia"), /only|just|goal|target|missed|low|!/i);
});

test("the monthly line: on the monthly birthday and the two days after, never on the birth day", async () => {
  const { effortMonth, effortLine } = await import("./effort.ts");
  assert.equal(effortMonth("2026-06-05", "2026-11-04"), null);
  assert.equal(effortMonth("2026-06-05", "2026-11-05"), 5);
  assert.equal(effortMonth("2026-06-05", "2026-11-07"), 5);
  assert.equal(effortMonth("2026-06-05", "2026-11-08"), null);
  assert.equal(effortMonth("2026-06-05", "2026-06-05"), null);
  assert.equal(effortMonth("2026-06-05", "2026-06-06"), null);
  assert.equal(effortMonth(null, "2026-11-05"), null);
  // A birth on the 31st: the monthly birthday is the last day of a shorter month.
  assert.equal(effortMonth("2026-01-31", "2026-02-28"), 1);
  assert.equal(effortMonth("2026-01-31", "2026-03-02"), 1);
  assert.equal(effortLine(1, "Mia"), "A month with Mia, counted");
  assert.equal(effortLine(5, "Mia"), "5 months with Mia, counted");
  assert.equal(effortLine(12, "Mia"), "A year with Mia, counted");
  assert.equal(effortLine(18, "Mia"), "18 months with Mia, counted");
  assert.equal(effortLine(24, "Mia"), "2 years with Mia, counted");
});
