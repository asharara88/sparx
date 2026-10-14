import { test } from "node:test";
import assert from "node:assert/strict";
import { formatSituation } from "./situation-format.ts";

test("the situation reads as a few plain lines", () => {
  const s = formatSituation({
    name: "Lana",
    nowLocal: "2026-10-14 15:02",
    ageDays: null,
    asleepSince: "2026-10-14 14:10",
    lastFeedAt: "2026-10-14 13:40",
    lastFeedMl: 120,
    lastFeedKind: "pumped",
    nextFeedDue: "2026-10-14 16:30",
    feedsToday: 5,
    diapersToday: 4,
    whoHas: "Wafa",
    plan: { goal: "Earlier bedtime", day: 3, days: 7, todayStep: "Start the wind-down at 18:30", doneToday: false },
  });
  assert.equal(
    s,
    ["Lana right now: asleep since 14:10.", "Last feed 13:40 (120 ml pumped), next due about 16:30.", "Today so far: 5 feeds, 4 nappies. Wafa has her.", 'Active plan "Earlier bedtime", day 3 of 7: Start the wind-down at 18:30 (not ticked yet today).'].join("\n"),
  );
});

test("nothing logged yet is said, not hidden", () => {
  const s = formatSituation({ name: "Lana", nowLocal: "", ageDays: null, asleepSince: null, lastFeedAt: null, lastFeedMl: null, lastFeedKind: null, nextFeedDue: null, feedsToday: 0, diapersToday: 0, whoHas: null, plan: null });
  assert.ok(s.includes("awake"));
  assert.ok(s.includes("No feed logged yet today."));
  assert.ok(!s.includes("Active plan"));
});
