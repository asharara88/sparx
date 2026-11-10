import { test } from "node:test";
import assert from "node:assert/strict";
import { formatHome, formatSituation, hm, minutesBetween } from "./situation-format.ts";

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

test("awake since, the last nappy, last night and the usual day are said when known", () => {
  const s = formatSituation({
    name: "Sam",
    them: "him",
    nowLocal: "2026-10-14 15:02",
    ageDays: 120,
    asleepSince: null,
    awakeSince: "2026-10-14 13:50",
    lastFeedAt: "2026-10-14 13:40",
    lastFeedMl: null,
    lastFeedKind: "breast left",
    nextFeedDue: null,
    lastDiaperAt: "2026-10-14 12:00",
    lastDiaperKind: "Dirty",
    feedsToday: 4,
    diapersToday: 3,
    whoHas: "Luda",
    plan: null,
    lastNight: { sleepMin: 540, wakes: 2, feeds: 1, longestMin: 200 },
    week: { days: 6, feeds: 7, bottleMl: 480, sleepMin: 840, nightMin: 560 },
  });
  const lines = s.split("\n");
  assert.equal(lines[0], "Sam right now: awake since 13:50 (1 h 12 min).");
  assert.equal(lines[1], "Last feed 13:40 (breast left).");
  assert.equal(lines[2], "Last nappy 12:00 (dirty).");
  assert.equal(lines[3], "Today so far: 4 feeds, 3 nappies. Luda has him.");
  assert.equal(lines[4], "Last night: 9 h of sleep, longest stretch 3 h 20 min, 2 wake-ups, 1 night feed.");
  assert.equal(lines[5], "Usual day lately (6 days): about 7 feeds and 480 ml of bottles, 14 h of sleep, 9 h 20 min of it at night.");
  assert.equal(hm(0), "0 min");
  assert.equal(minutesBetween("2026-10-14 23:50", "2026-10-15 00:10"), 20);
  assert.equal(minutesBetween("2026-10-14 23:50", "2026-10-14 23:00"), null);
});

test("who is in the house is one line, or nothing", () => {
  assert.equal(
    formatHome([
      { name: "Dana", inHouse: true, label: "Lives here", worksToday: false },
      { name: "Wafa", inHouse: false, label: "Away until 2026-11-05", worksToday: false },
      { name: "Lilly", inHouse: true, label: "Lives here", worksToday: true },
      { name: "Haitham", inHouse: null, label: null, worksToday: false },
    ]),
    "Household now: In the house: Dana, Lilly. Away: Wafa (away until 2026-11-05). Working today: Lilly.",
  );
  assert.equal(formatHome([]), "");
});

test("today's meals are in the counts once the child eats, and not before", () => {
  const base = { name: "Lana", nowLocal: "", ageDays: 220, asleepSince: null, lastFeedAt: null, lastFeedMl: null, lastFeedKind: null, nextFeedDue: null, feedsToday: 4, diapersToday: 3, whoHas: null, plan: null };
  assert.match(formatSituation({ ...base, mealsToday: 2 }), /Today so far: 4 feeds, 3 nappies, 2 meals\./);
  assert.match(formatSituation({ ...base, mealsToday: 1 }), /3 nappies, 1 meal\./);
  assert.match(formatSituation({ ...base, ageDays: 120 }), /Today so far: 4 feeds, 3 nappies\./);
});

test("formatMilk: the stash in one line for the helper", async () => {
  const { formatMilk } = await import("./situation-format.ts");
  assert.equal(formatMilk({ fridge_ml: 270, fridge_count: 2, freezer_ml: 120, freezer_count: 1 }), "Milk at home: fridge 270 ml in 2 bottles, freezer 120 ml in 1 bag.");
  assert.equal(formatMilk({ fridge_ml: 0, fridge_count: 0, freezer_ml: 0, freezer_count: 0 }), "Milk at home: fridge empty, freezer empty.");
  assert.equal(formatMilk(null), null);
});
