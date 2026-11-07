import { test } from "node:test";
import assert from "node:assert/strict";
import { byDay, dayLabel } from "./by-day.ts";

test("entries grouped by day, newest day and newest entry first", () => {
  const dayOf = (iso: string) => iso.slice(0, 10);
  const g = byDay([{ occurred_at: "2026-11-06T09:00:00Z" }, { occurred_at: "2026-11-07T08:00:00Z" }, { occurred_at: "2026-11-07T13:00:00Z" }, { occurred_at: "2026-11-05T20:00:00Z" }], dayOf);
  assert.deepEqual(g.map((x) => x.day), ["2026-11-07", "2026-11-06", "2026-11-05"]);
  assert.deepEqual(g[0].entries.map((e) => e.occurred_at), ["2026-11-07T13:00:00Z", "2026-11-07T08:00:00Z"]);
});

test("today, yesterday, then weekdays", () => {
  assert.equal(dayLabel("2026-11-07", "2026-11-07"), "Today");
  assert.equal(dayLabel("2026-11-06", "2026-11-07"), "Yesterday");
  assert.equal(dayLabel("2026-11-03", "2026-11-07"), "Tuesday");
});
