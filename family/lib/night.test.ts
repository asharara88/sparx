import { test } from "node:test";
import assert from "node:assert/strict";
import { hhmmIn, inNight, isNightAt, nightWindow } from "./night.ts";

test("the window comes from the settings, with defaults when unset or malformed", () => {
  assert.deepEqual(nightWindow(null), { from: "19:00", to: "07:00" });
  assert.deepEqual(nightWindow({}), { from: "19:00", to: "07:00" });
  assert.deepEqual(nightWindow({ night_from: "20:30", night_to: "06:00" }), {
    from: "20:30",
    to: "06:00",
  });
  assert.deepEqual(
    nightWindow({ night_from: "20:30:00", night_to: "06:00:00" }),
    { from: "20:30", to: "06:00" },
    "a time with seconds is trimmed",
  );
  assert.deepEqual(
    nightWindow({ night_from: "7pm", night_to: 7 }),
    { from: "19:00", to: "07:00" },
    "junk falls back",
  );
});

test("a window across midnight wraps; one inside the day does not", () => {
  assert.equal(inNight("22:00", "19:00", "07:00"), true);
  assert.equal(inNight("03:15", "19:00", "07:00"), true);
  assert.equal(inNight("19:00", "19:00", "07:00"), true, "the start is in");
  assert.equal(inNight("07:00", "19:00", "07:00"), false, "the end is out");
  assert.equal(inNight("12:00", "19:00", "07:00"), false);
  assert.equal(inNight("13:00", "12:00", "14:00"), true);
  assert.equal(inNight("15:00", "12:00", "14:00"), false);
  assert.equal(
    inNight("12:00", "12:00", "12:00"),
    false,
    "an empty window is never night",
  );
});

test("the clock is read in the household's time zone", () => {
  const at = Date.UTC(2026, 9, 22, 20, 30); // 00:30 in Dubai, 23:30 in Cairo
  assert.equal(hhmmIn(at, "Asia/Dubai"), "00:30");
  assert.equal(hhmmIn(at, "Africa/Cairo"), "23:30");
  assert.equal(hhmmIn(at, "UTC"), "20:30");
  assert.equal(
    isNightAt(at, "Asia/Dubai", { night_from: "19:00", night_to: "07:00" }),
    true,
  );
  assert.equal(
    isNightAt(Date.UTC(2026, 9, 22, 8, 0), "Asia/Dubai", null),
    false,
    "noon in Dubai",
  );
});
