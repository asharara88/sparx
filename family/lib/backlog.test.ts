import { test } from "node:test";
import assert from "node:assert/strict";
import { bottleChoices, napLengths, overlappingSleep } from "./backlog.ts";

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
