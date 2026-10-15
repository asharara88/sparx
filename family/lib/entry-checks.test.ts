import { test } from "node:test";
import assert from "node:assert/strict";
import { checkEntries, type CheckEntry } from "./entry-checks.ts";

const T0 = Date.parse("2026-10-14T10:00:00Z");
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
let n = 0;
const mk = (type: string, start: number, end: number | null = null, payload: Record<string, unknown> = {}): CheckEntry => ({ id: `e${++n}`, type_id: `lana.${type}`, occurred_at: at(start), ended_at: end == null ? null : at(end), payload });

test("a clean day raises nothing", () => {
  const flags = checkEntries([mk("feed", 0, 15, { method: "Breast", side: "Left" }), mk("diaper", 20, null, { kind: "Wet" }), mk("sleep", 30, 90), mk("feed", 100, null, { method: "Bottle", amount_ml: 120 })], { now: T0 + 110 * 60_000 });
  assert.deepEqual(flags, []);
});

test("a sleep with feeds logged during it is a timer left on; the fix ends it at the first feed", () => {
  const sleep = mk("sleep", 0, 11 * 60);
  const feed = mk("feed", 180, 195, { method: "Breast", side: "Right" });
  const flags = checkEntries([sleep, feed, mk("diaper", 200, null, { kind: "Wet" })], { now: T0 + 12 * 3_600_000 });
  assert.equal(flags.length, 1);
  assert.equal(flags[0].kind, "overlap");
  assert.equal(flags[0].entry.id, sleep.id);
  assert.equal(flags[0].fix?.ended_at, feed.occurred_at);
});

test("a two-hour feed on one side is trimmed to 20 minutes", () => {
  const feed = mk("feed", 0, 120, { method: "Breast", side: "Left" });
  const flags = checkEntries([feed], { now: T0 + 3 * 3_600_000 });
  assert.equal(flags[0].kind, "long_feed");
  assert.equal(flags[0].fix?.ended_at, at(20));
  assert.equal(checkEntries([{ ...feed, payload: { ...feed.payload, timer_ok: true } }]).length, 0, "once confirmed real it is not asked again");
});

test("a sleep over 10 hours with nothing logged during it is flagged without a fix", () => {
  const flags = checkEntries([mk("sleep", 0, 11 * 60)], { now: T0 + 14 * 3_600_000 });
  assert.equal(flags[0].kind, "long_sleep");
  assert.equal(flags[0].fix, null);
  assert.equal(checkEntries([mk("sleep", 0, 9 * 60)], { now: T0 + 14 * 3_600_000 }).length, 0, "nine hours is a good night");
});

test("a sleep timer still running after 12 hours is ended at the next entry", () => {
  const sleep = mk("sleep", 0, null);
  const diaper = mk("diaper", 8 * 60, null, { kind: "Dirty" });
  const flags = checkEntries([sleep, diaper], { now: T0 + 13 * 3_600_000 });
  assert.equal(flags[0].kind, "open_timer");
  assert.equal(flags[0].fix?.ended_at, diaper.occurred_at);
  const feedOpen = checkEntries([mk("feed", 0, null, { method: "Breast" })], { now: T0 + 60 * 60_000 });
  assert.equal(feedOpen[0].fix?.label, "End it at 20 min");
  assert.equal(checkEntries([mk("sleep", 0, null)], { now: T0 + 4 * 3_600_000 }).length, 0, "four hours asleep is fine");
});

test("one-second timers and double nappies suggest delete", () => {
  const flags = checkEntries([mk("sleep", 0, 0.1), mk("diaper", 10, null, { kind: "Both" }), mk("diaper", 10.5, null, { kind: "Dirty" })], { now: T0 + 60 * 60_000 });
  assert.deepEqual(flags.map((f) => [f.kind, f.suggestDelete]), [["short_timer", true], ["double", true]]);
});

test("a 400 ml bottle is questioned", () => {
  const flags = checkEntries([mk("feed", 0, null, { method: "Bottle", amount_ml: 400 })]);
  assert.equal(flags[0].kind, "big_bottle");
});

test("a night wake during a sleep does not count as an overlap", () => {
  const flags = checkEntries([mk("sleep", 0, 10 * 60), mk("wake", 240, 255)], { now: T0 + 11 * 3_600_000 });
  assert.deepEqual(flags, []);
});
