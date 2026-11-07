import { test } from "node:test";
import assert from "node:assert/strict";
import { dayWord, parseClock, resolveTyped } from "./typed-time.ts";

test("the ways people type a time", () => {
  assert.deepEqual(parseClock("2130"), { h: 21, m: 30 });
  assert.deepEqual(parseClock("21:30"), { h: 21, m: 30 });
  assert.deepEqual(parseClock("21.30"), { h: 21, m: 30 });
  assert.deepEqual(parseClock("930"), { h: 9, m: 30 });
  assert.deepEqual(parseClock("0705"), { h: 7, m: 5 });
  assert.deepEqual(parseClock("9"), { h: 9, m: 0 });
  assert.deepEqual(parseClock("9pm"), { h: 21, m: 0 });
  assert.deepEqual(parseClock("9:30 PM"), { h: 21, m: 30 });
  assert.deepEqual(parseClock("12am"), { h: 0, m: 0 });
  assert.deepEqual(parseClock("12pm"), { h: 12, m: 0 });
  for (const bad of ["", "abc", "2460", "25", "13pm", "9:75", "12345"]) assert.equal(parseClock(bad), null, bad);
});

test("the most recent such time: 21:30 typed at 02:00 is last night, 01:30 is tonight's", () => {
  assert.equal(resolveTyped("2130", "2026-11-07T02:00"), "2026-11-06T21:30");
  assert.equal(resolveTyped("130", "2026-11-07T02:00"), "2026-11-07T01:30");
  assert.equal(resolveTyped("0200", "2026-11-07T02:00"), "2026-11-07T02:00", "now itself is allowed");
  assert.equal(resolveTyped("1300", "2026-11-07T14:00", { yesterday: true }), "2026-11-06T13:00");
  assert.equal(resolveTyped("2130", "2026-11-07T02:00", { yesterday: true }), "2026-11-06T21:30", "already yesterday");
});

test("on a given day: a past day's entry, or the day before it", () => {
  assert.equal(resolveTyped("945", "2026-11-07T14:00", { day: "2026-11-03" }), "2026-11-03T09:45");
  assert.equal(resolveTyped("2350", "2026-11-07T14:00", { day: "2026-11-03", yesterday: true }), "2026-11-02T23:50");
  assert.equal(resolveTyped("1201", "2026-03-01T14:00", { day: "2026-03-01", yesterday: true }), "2026-02-28T12:01", "month edge");
});

test("read back in words", () => {
  assert.equal(dayWord("2026-11-07T09:30", "2026-11-07T14:00"), "today 09:30");
  assert.equal(dayWord("2026-11-06T21:30", "2026-11-07T02:00"), "yesterday 21:30");
  assert.equal(dayWord("2026-11-03T09:45", "2026-11-07T14:00"), "3 Nov 09:45");
});
