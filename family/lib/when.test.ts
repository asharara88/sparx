import { test } from "node:test";
import assert from "node:assert/strict";
import { agoLabel, clockMarks, isEarlier, maxDurationMin, NOW, recallWhen, RECALL_MS, whenToIso } from "./when.ts";

const NOW_MS = Date.UTC(2026, 9, 16, 12, 0);
const fromLocal = (local: string) => `${local}:00.000Z`;

test("whenToIso: now, minutes ago, or a wall-clock time", () => {
  assert.equal(whenToIso(NOW, NOW_MS, fromLocal), "2026-10-16T12:00:00.000Z");
  assert.equal(whenToIso({ kind: "ago", min: 90 }, NOW_MS, fromLocal), "2026-10-16T10:30:00.000Z");
  assert.equal(whenToIso({ kind: "at", local: "2026-10-16T08:15" }, NOW_MS, fromLocal), "2026-10-16T08:15:00.000Z");
  assert.equal(isEarlier(NOW), false);
  assert.equal(isEarlier({ kind: "ago", min: 15 }), true);
});

test("labels and the cap on a backfilled duration", () => {
  assert.equal(agoLabel(45), "45 min ago");
  assert.equal(agoLabel(60), "1 h ago");
  assert.equal(agoLabel(90), "1.5 h ago");
  assert.equal(maxDurationMin("2026-10-16T11:20:00.000Z", NOW_MS), 40);
  assert.equal(maxDurationMin("2026-10-16T13:00:00.000Z", NOW_MS), 0);
});

// Dubai is UTC+4 all year: a fixed offset is enough to stand in for the household zone.
const dubai = (iso: string) => new Date(Date.parse(iso) + 4 * 3_600_000).toISOString().slice(0, 16);
const at = (hm: string) => Date.parse(`2026-10-29T${hm}:00+04:00`);

test("clockMarks: the last two hours as clock times on the ten-minute grid, newest first", () => {
  const marks = clockMarks(at("14:00"), dubai);
  assert.equal(marks.length, 12);
  assert.equal(marks[0], "2026-10-29T13:50");
  assert.equal(marks[11], "2026-10-29T12:00");
  // The acceptance scenario: a bottle at 12:40 and a nap from 13:00, each one tap.
  assert.ok(marks.includes("2026-10-29T12:40"));
  assert.ok(marks.includes("2026-10-29T13:00"));
});

test("clockMarks: a mark under five minutes old is now, not earlier", () => {
  assert.equal(clockMarks(at("14:03"), dubai)[0], "2026-10-29T13:50");
  assert.equal(clockMarks(at("14:07"), dubai)[0], "2026-10-29T14:00");
  assert.deepEqual(clockMarks(at("14:07"), dubai, 0), []);
});

test("clockMarks: crosses midnight into yesterday", () => {
  const marks = clockMarks(at("00:20"), dubai, 3);
  assert.deepEqual(marks, ["2026-10-29T00:10", "2026-10-29T00:00", "2026-10-28T23:50"]);
});

test("recallWhen: a time from earlier carries to the next sheet for under a minute, then now", () => {
  const picked = { kind: "at", local: "2026-10-29T12:40" } as const;
  const savedAt = at("14:00");
  assert.deepEqual(recallWhen({ when: picked, at: savedAt }, savedAt + 20_000), picked);
  assert.deepEqual(recallWhen({ when: picked, at: savedAt }, savedAt + RECALL_MS), NOW);
  assert.deepEqual(recallWhen({ when: NOW, at: savedAt }, savedAt + 1_000), NOW);
  assert.deepEqual(recallWhen(null, savedAt), NOW);
  // A clock that went backwards is not a reason to backdate.
  assert.deepEqual(recallWhen({ when: picked, at: savedAt }, savedAt - 1_000), NOW);
});
