import { test } from "node:test";
import assert from "node:assert/strict";

const TZ = "Asia/Dubai"; // UTC+4, no clock changes
const HER = "her";
const HIM = "him";
// The night of 24 to 25 November at home: 23:00 on the 24th is 19:00 UTC.
const at = (hhmm: string, day = hhmm >= "12:00" ? "2026-11-24" : "2026-11-25") => new Date(`${day}T${hhmm}:00+04:00`).toISOString();
const row = (hhmm: string, more: Partial<{ type_id: string; ended: string; payload: Record<string, unknown>; by: string }> = {}) => ({
  type_id: more.type_id ?? "lana.feed",
  occurred_at: at(hhmm),
  ended_at: more.ended ? at(more.ended) : null,
  payload: more.payload ?? {},
  logged_by: more.by ?? HER,
});

test("the window: 23:00 to 06:00 at home, filed under the day it started", async () => {
  const { nightOf } = await import("./nights.ts");
  const w = nightOf("2026-11-25", TZ);
  assert.equal(new Date(w.from).toISOString(), "2026-11-24T19:00:00.000Z");
  assert.equal(new Date(w.to).toISOString(), "2026-11-25T02:00:00.000Z");
  assert.equal(w.day, "2026-11-24");
});

test("a child whose morning is earlier ends the window earlier; a later morning does not stretch it", async () => {
  const { nightOf } = await import("./nights.ts");
  assert.equal(new Date(nightOf("2026-11-25", TZ, "05:30").to).toISOString(), "2026-11-25T01:30:00.000Z");
  assert.equal(new Date(nightOf("2026-11-25", TZ, "07:00").to).toISOString(), "2026-11-25T02:00:00.000Z");
  assert.equal(new Date(nightOf("2026-11-25", TZ, "nonsense").to).toISOString(), "2026-11-25T02:00:00.000Z");
});

test("another time zone: the window follows the home's clock", async () => {
  const { nightOf } = await import("./nights.ts");
  const w = nightOf("2026-07-10", "Europe/London"); // UTC+1 in summer
  assert.equal(new Date(w.from).toISOString(), "2026-07-09T22:00:00.000Z");
  assert.equal(new Date(w.to).toISOString(), "2026-07-10T05:00:00.000Z");
});

test("nothing saved, or one time up: nothing is said", async () => {
  const { memberNight, nightOf } = await import("./nights.ts");
  const w = nightOf("2026-11-25", TZ);
  assert.equal(memberNight([], HER, w), null);
  assert.equal(memberNight([row("02:10")], HER, w), null);
});

test("a feed, a nappy and a pump within half an hour of each other are one time up", async () => {
  const { memberNight, nightOf } = await import("./nights.ts");
  const w = nightOf("2026-11-25", TZ);
  assert.equal(memberNight([row("02:00"), row("02:10", { type_id: "lana.diaper" }), row("02:35", { type_id: "lana.pump" })], HER, w), null);
});

test("three times up, and the longest quiet stretch with both edges of the night", async () => {
  const { memberNight, nightOf } = await import("./nights.ts");
  const w = nightOf("2026-11-25", TZ);
  // 23:00 .. 00:30 (90), 00:30 .. 02:00 (90), 02:00 .. 04:45 (165), 04:45 .. 06:00 (75)
  assert.deepEqual(memberNight([row("04:45"), row("00:30"), row("02:00")], HER, w), { times: 3, longestMin: 165 });
  // The stretch before the first time up can be the longest.
  assert.deepEqual(memberNight([row("04:00"), row("05:00")], HER, w), { times: 2, longestMin: 300 });
  // And the one after the last.
  assert.deepEqual(memberNight([row("00:05"), row("01:10")], HER, w), { times: 2, longestMin: 290 });
});

test("a 40 minute breastfeed is 40 minutes awake; a save half an hour after it ends joins it", async () => {
  const { memberNight, nightOf } = await import("./nights.ts");
  const w = nightOf("2026-11-25", TZ);
  // Busy 01:00 to 01:40; 02:05 is within 30 minutes of 01:40: one time up. 04:00 is the second.
  assert.deepEqual(memberNight([row("01:00", { ended: "01:40" }), row("02:05", { type_id: "lana.diaper" }), row("04:00")], HER, w), { times: 2, longestMin: 120 });
});

test("a timer left running is capped at 90 minutes, and at the end of the night", async () => {
  const { memberNight, nightOf } = await import("./nights.ts");
  const w = nightOf("2026-11-25", TZ);
  // Busy 00:00 to 01:30 (not to 04:00), so 02:30 is a second time up.
  assert.deepEqual(memberNight([row("00:00", { ended: "04:00" }), row("02:30")], HER, w), { times: 2, longestMin: 210 });
  // A feed begun at 05:40 is busy to 06:00, not beyond.
  assert.deepEqual(memberNight([row("01:00"), row("05:40", { ended: "06:30" })], HER, w), { times: 2, longestMin: 280 });
});

test("a sleep, and a timer the app closed by itself, are one moment each", async () => {
  const { memberNight, nightOf } = await import("./nights.ts");
  const w = nightOf("2026-11-25", TZ);
  // The sleep 00:30 to 03:00 is the child's, not time she was awake: 02:00 is a separate time up.
  assert.deepEqual(memberNight([row("00:30", { type_id: "lana.sleep", ended: "03:00" }), row("02:00")], HER, w), { times: 2, longestMin: 240 });
  assert.deepEqual(memberNight([row("00:00", { ended: "01:30", payload: { auto_end: true } }), row("01:00")], HER, w), { times: 2, longestMin: 300 });
});

test("what is saved before midnight is the evening, not a time up", async () => {
  const { memberNight, nightOf } = await import("./nights.ts");
  const w = nightOf("2026-11-25", TZ);
  // A last feed and the child's sleep, then she slept through: bedtime, not a broken night.
  assert.equal(memberNight([row("23:05"), row("23:40", { type_id: "lana.sleep" })], HER, w), null);
  // The evening's tail and one waking is still one waking.
  assert.equal(memberNight([row("23:25", { type_id: "lana.diaper" }), row("03:00")], HER, w), null);
  assert.equal(memberNight([row("23:10"), row("23:55"), row("03:00")], HER, w), null);
  // Two wakings after it: twice. The quiet stretch runs from the last evening save, not from 23:00.
  assert.deepEqual(memberNight([row("23:05"), row("23:40"), row("03:00"), row("05:00")], HER, w), { times: 2, longestMin: 200 });
  // Midnight itself is the night.
  assert.deepEqual(memberNight([row("00:00"), row("02:00")], HER, w), { times: 2, longestMin: 240 });
});

test("22:50 and 06:10 are outside the night", async () => {
  const { memberNight, nightOf } = await import("./nights.ts");
  const w = nightOf("2026-11-25", TZ);
  assert.equal(memberNight([row("22:50"), row("06:10"), row("03:00")], HER, w), null);
});

test("only what she saved herself counts, even when another's entry is in her name", async () => {
  const { memberNight, nightOf } = await import("./nights.ts");
  const w = nightOf("2026-11-25", TZ);
  const his = { ...row("01:00", { by: HIM }), attributed_to: HER };
  assert.equal(memberNight([his, row("03:00")], HER, w), null);
  assert.equal(memberNight([row("01:00"), row("03:00")], HIM, w), null);
});

test("latestNight: the most recent finished night with a line, never one still going", async () => {
  const { latestNight } = await import("./nights.ts");
  const rows = [row("01:00"), row("03:00")]; // the night of the 24th
  const noon25 = Date.parse("2026-11-25T12:00:00+04:00");
  const got = latestNight(rows, HER, "2026-11-25", TZ, noon25);
  assert.equal(got?.win.day, "2026-11-24");
  assert.equal(got?.night.times, 2);
  // Two days on, it is still the latest one with a line.
  assert.equal(latestNight(rows, HER, "2026-11-27", TZ, Date.parse("2026-11-27T12:00:00+04:00"))?.win.day, "2026-11-24");
  // At 02:00 on the 25th that night is not over: it is not read.
  assert.equal(latestNight(rows, HER, "2026-11-25", TZ, Date.parse("2026-11-25T02:00:00+04:00")), null);
  // Seven nights back is out of reach.
  assert.equal(latestNight(rows, HER, "2026-12-02", TZ, Date.parse("2026-12-02T12:00:00+04:00")), null);
});

test("the words: twice, then a number; never a judgement", async () => {
  const { nightLine, timesWords, stretchWords, nightName } = await import("./nights.ts");
  assert.equal(nightLine("Sara", 2), "Sara was up twice in the night");
  assert.equal(nightLine("Sara", 3), "Sara was up 3 times in the night");
  assert.equal(timesWords(2), "Up twice.");
  assert.equal(timesWords(5), "Up 5 times.");
  assert.equal(stretchWords(45), "under an hour");
  assert.equal(stretchWords(60), "about 1 h");
  assert.equal(stretchWords(119), "about 1 h 30 min");
  assert.equal(stretchWords(165), "about 2 h 30 min");
  assert.equal(stretchWords(300), "about 5 h");
  assert.equal(nightName("2026-11-24", "2026-11-25"), "last night");
  assert.equal(nightName("2026-11-22", "2026-11-25"), "Sunday night");
  for (const times of [2, 3, 4, 7, 12]) {
    const line = nightLine("Sara", times);
    assert.doesNotMatch(`${line} ${timesWords(times)}`, /only|just|lost|missed|low|slept|bad|!/i);
    assert.ok((line.match(/\d+/g) ?? []).length <= 1, "at most one number on Home's line");
  }
  for (const min of [10, 60, 95, 200, 420]) assert.doesNotMatch(stretchWords(min), /only|just|lost|missed|low|slept|bad|!/i);
});
