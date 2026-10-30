import { test } from "node:test";
import assert from "node:assert/strict";
import { bottleChoices, longestSleep, napLengths, napWindow, overlappingSleep } from "./backlog.ts";

const at = (hm: string, day = "29") => `2026-10-${day}T${hm}:00+04:00`;
const ms = (hm: string) => Date.parse(at(hm));

test("bottleChoices: the last bottle is the usual amount, and always a chip", () => {
  assert.deepEqual(bottleChoices([60, 90, 120, 150], 90), { amounts: [60, 90, 120, 150], usual: 90 });
  assert.deepEqual(bottleChoices([60, 90, 120, 150], 100), { amounts: [60, 90, 100, 120, 150], usual: 100 });
  assert.deepEqual(bottleChoices([60, 90, 120, 150], null), { amounts: [60, 90, 120, 150], usual: null });
  assert.deepEqual(bottleChoices([60, 90], 0), { amounts: [60, 90], usual: null });
});

test("napLengths: only lengths that end by now", () => {
  assert.deepEqual(napLengths(ms("13:00"), ms("14:00")), [20, 30, 45, 60]);
  assert.deepEqual(napLengths(ms("13:50"), ms("14:00")), []);
});

test("overlappingSleep: a nap from earlier on top of one already logged is found", () => {
  const logged = [
    { id: "feed", type_id: "lana.feed", occurred_at: at("13:10"), ended_at: at("13:20") },
    { id: "nap", type_id: "lana.sleep", occurred_at: at("13:30"), ended_at: at("14:10") },
  ];
  assert.equal(overlappingSleep(logged, ms("13:00"), ms("13:45"), ms("14:30"))?.id, "nap");
  // Touching ends are not an overlap; a feed is never one.
  assert.equal(overlappingSleep(logged, ms("12:30"), ms("13:30"), ms("14:30")), null);
});

test("overlappingSleep: an open sleep runs to now, unless it is a timer left on for over 12 hours", () => {
  const open = [{ id: "open", type_id: "lana.sleep", occurred_at: at("13:30"), ended_at: null }];
  assert.equal(overlappingSleep(open, ms("13:00"), ms("13:45"), ms("14:00"))?.id, "open");
  const stale = [{ id: "stale", type_id: "lana.sleep", occurred_at: at("13:30", "24"), ended_at: null }];
  assert.equal(overlappingSleep(stale, ms("13:00"), ms("13:45"), ms("14:00")), null);
});

test("napWindow: a quarter of an hour either side, the bar from waking to the window's end", () => {
  // Woke 09:30, nap predicted 11:35 (window 11:20 to 11:50), now 11:00.
  const w = napWindow(ms("09:30"), ms("11:35"), ms("11:00"));
  assert.equal(w.from, ms("11:20"));
  assert.equal(w.to, ms("11:50"));
  assert.equal(w.untilMin, 20);
  assert.equal(w.late, 0);
  assert.equal(w.pct, pctOf(90, 140));
  assert.equal(w.windowStartPct, pctOf(110, 140));
  // A prediction off the five minutes is rounded onto them.
  assert.equal(napWindow(ms("09:30"), ms("11:36"), ms("11:00")).from, ms("11:20"));
  // Inside the window, then past it.
  assert.equal(napWindow(ms("09:30"), ms("11:35"), ms("11:30")).untilMin, 0);
  assert.equal(napWindow(ms("09:30"), ms("11:35"), ms("12:05")).late, 15);
  assert.equal(napWindow(ms("09:30"), ms("11:35"), ms("12:05")).pct, 100);
});

function pctOf(part: number, whole: number) {
  return Math.round((part / whole) * 100);
}

test("longestSleep: the longest sleep that started in the span, a timer left on not counted", () => {
  const log = [
    { type_id: "lana.sleep", occurred_at: at("01:00"), ended_at: at("06:40") },
    { type_id: "lana.sleep", occurred_at: at("13:00"), ended_at: at("13:45") },
    { type_id: "lana.feed", occurred_at: at("02:00"), ended_at: at("09:00") },
    { type_id: "lana.sleep", occurred_at: at("13:00", "20"), ended_at: null },
  ];
  assert.equal(longestSleep(log, ms("00:00"), ms("23:59"), ms("23:59")), 340);
  assert.equal(longestSleep(log, ms("12:00"), ms("23:59"), ms("23:59")), 45);
  assert.equal(longestSleep([], ms("00:00"), ms("23:59"), ms("23:59")), 0);
});
