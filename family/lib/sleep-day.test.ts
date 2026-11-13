import { test } from "node:test";
import assert from "node:assert/strict";
import { sleepDay } from "./sleep-day.ts";

// A day in UTC for simplicity: midnight is 00:00Z, the hour is the UTC hour.
const DAY = Date.parse("2026-11-04T00:00:00Z");
const h = (hh: number, mm = 0) => DAY + (hh * 60 + mm) * 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
const opts = { bedtimeHour: 19, morningHour: 7, hourOf: (ms: number) => new Date(ms).getUTCHours() + new Date(ms).getUTCMinutes() / 60 };
const sleep = (from: number, to: number | null) => ({ type_id: "lana.sleep", occurred_at: iso(from), ended_at: to == null ? null : iso(to) });

test("the night she woke from, two naps, awake since the second one", () => {
  const s = sleepDay([sleep(h(-5), h(7, 10)), sleep(h(10, 30), h(11, 15)), sleep(h(13), h(14, 10)), { type_id: "lana.feed", occurred_at: iso(h(8)), ended_at: null }], DAY, h(15, 25), opts);
  assert.deepEqual(s.segments.map((x) => [x.kind, x.from - DAY, x.to - DAY, x.open]), [
    ["night", 0, 7 * 60 * 60_000 + 10 * 60_000, false],
    ["nap", h(10, 30) - DAY, h(11, 15) - DAY, false],
    ["nap", h(13) - DAY, h(14, 10) - DAY, false],
  ]);
  assert.equal(s.wokeAt, h(7, 10));
  assert.equal(s.naps, 2);
  assert.equal(s.napMin, 45 + 70);
  assert.equal(s.nightMin, 430);
  assert.deepEqual(s.state, { kind: "awake", since: h(14, 10), afterNap: true });
});

test("asleep now: a nap clipped at now, and the morning wake stays known", () => {
  const s = sleepDay([sleep(h(-5), h(7, 10)), sleep(h(13), null)], DAY, h(13, 45), opts);
  assert.deepEqual(s.state, { kind: "asleep", since: h(13), sleep: "nap" });
  assert.equal(s.segments[1].open, true);
  assert.equal(s.segments[1].to, h(13, 45));
  assert.equal(s.napMin, 45);
  assert.equal(s.wokeAt, h(7, 10));
});

test("a night split by a wake-up at 02:00 is still the night, and the morning wake is the later end", () => {
  const s = sleepDay([sleep(h(-5), h(2)), sleep(h(3), h(7))], DAY, h(9), opts);
  assert.deepEqual(s.segments.map((x) => x.kind), ["night", "night"]);
  assert.equal(s.wokeAt, h(7));
  assert.equal(s.naps, 0);
  assert.equal(s.nightMin, 120 + 240);
  assert.deepEqual(s.state, { kind: "awake", since: h(7), afterNap: false });
  // Back to sleep at 03:00 after the wake-up: asleep for the night, not a nap.
  assert.deepEqual(sleepDay([sleep(h(-5), h(2)), sleep(h(3), null)], DAY, h(5), opts).state, { kind: "asleep", since: h(3), sleep: "night" });
});

test("bedtime counts as night, a gap over twelve hours says nothing, a timer left on is ignored", () => {
  const night = sleepDay([sleep(h(-5), h(7)), sleep(h(19, 30), null)], DAY, h(21), opts);
  assert.deepEqual(night.state, { kind: "asleep", since: h(19, 30), sleep: "night" });
  assert.equal(night.nightMin, 420 + 90);
  const gap = sleepDay([sleep(h(-5), h(6))], DAY, h(19), opts);
  assert.deepEqual(gap.state, { kind: "unknown" });
  const left = sleepDay([sleep(h(-30), null)], DAY, h(10), opts);
  assert.equal(left.segments.length, 0);
  assert.deepEqual(left.state, { kind: "unknown" });
  assert.deepEqual(sleepDay([], DAY, h(10), opts), { segments: [], state: { kind: "unknown" }, wokeAt: null, naps: 0, napMin: 0, nightMin: 0 });
});

test("still in the night: a wake before noon followed by more night sleep is not the morning wake", () => {
  // 03:00, back to sleep at 02:30 after a wake at 02:00.
  assert.equal(sleepDay([sleep(h(-5), h(2)), sleep(h(2, 30), null)], DAY, h(3), opts).wokeAt, null);
  // 10:00, up at 06:10 and down again at 06:33, still asleep.
  assert.equal(sleepDay([sleep(h(-5), h(6, 10)), sleep(h(6, 33), null)], DAY, h(10), opts).wokeAt, null);
  // 21:00, woke at 07:00 and down for the next night at 19:30: today's wake stays.
  assert.equal(sleepDay([sleep(h(-5), h(7)), sleep(h(19, 30), null)], DAY, h(21), opts).wokeAt, h(7));
});
