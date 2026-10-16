import { test } from "node:test";
import assert from "node:assert/strict";
import { agoLabel, isEarlier, maxDurationMin, NOW, whenToIso } from "./when.ts";

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
