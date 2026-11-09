import { test } from "node:test";
import assert from "node:assert/strict";

const N = { target: 400, goal_from: 360, today_ml: 150, best_run: 4, current_run: 4, beat_days: 2, freezer_ml: 720 };

test("headline: the tier's name and what it took", async () => {
  const { headline } = await import("./achievements.ts");
  assert.deepEqual(headline("pump_goal", 4), { title: "Gold!", line: "14 days on goal in a row" });
  assert.deepEqual(headline("stash", 2), { title: "A litre saved!", line: "1 litre in the freezer at once" });
  assert.deepEqual(headline("pump_beat", 1), { title: "Over the top!", line: "A day well over the goal" });
});

test("nextUp: the first tier not won, and how far there is to go", async () => {
  const { nextUp } = await import("./achievements.ts");
  assert.deepEqual(nextUp("pump_goal", N, [1, 2]), { tier: { tier: 3, need: 7, metal: "silver", name: "Silver" }, have: 4, left: 3 });
  assert.equal(nextUp("stash", N, [1])?.left, 280);
  assert.equal(nextUp("pump_beat", N, [1, 2, 3]), null, "every tier won");
});

test("keepRun: a nudge only while a run is going and today is short of the goal", async () => {
  const { keepRun } = await import("./achievements.ts");
  assert.equal(keepRun(N), "210 ml more today keeps your 4-day run");
  assert.equal(keepRun({ ...N, today_ml: 380 }), null, "on goal already");
  assert.equal(keepRun({ ...N, current_run: 0 }), null, "no run to keep");
  assert.equal(keepRun({ ...N, target: 0 }), null, "no goal set");
});

test("the tiers match the database's (migration 5900)", async () => {
  const { TRACKS } = await import("./achievements.ts");
  const { readFileSync } = await import("node:fs");
  const sql = readFileSync(new URL("../supabase/migrations/20261010005900_achievements.sql", import.meta.url), "utf8");
  for (const t of TRACKS) for (const x of t.tiers) assert.ok(sql.includes(`('${t.id}', ${x.tier}, ${x.need})`), `${t.id} tier ${x.tier} needs ${x.need} in both`);
});
