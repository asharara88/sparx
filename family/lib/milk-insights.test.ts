import { test } from "node:test";
import assert from "node:assert/strict";
import { milkForecast, pumpInsights, thawPlan, usualBottle } from "./milk-insights.ts";
import type { EntryRow, MilkBottle } from "./types.ts";

const D = 86_400_000;
const NOW = Date.UTC(2026, 9, 13, 16, 0);
const iso = (ms: number) => new Date(ms).toISOString();
const row = (type_id: string, at: number, payload: Record<string, unknown>): EntryRow => ({ id: `${type_id}-${at}`, type_id, type_label: type_id, icon: null, occurred_at: iso(at), ended_at: null, payload, note: null });
const bottle = (at: number, amount: number): EntryRow => row("lana.feed", at, { method: "Bottle", amount_ml: amount });
const pump = (at: number, amount: number): EntryRow => row("lana.pump", at, { amount_ml: amount });
const bag = (id: string, location: "fridge" | "freezer", amount_ml: number, daysAgo: number, expired = false): MilkBottle => ({ id, amount_ml, pumped_at: iso(NOW - daysAgo * D), location, thawed_at: null, warmed_at: null, expires_at: iso(NOW + 30 * D), expired, note: null });

test("usual bottle is the median, 120 with too few", () => {
  assert.equal(usualBottle([bottle(NOW, 90), bottle(NOW, 150)]), 120);
  assert.equal(usualBottle([bottle(NOW, 90), bottle(NOW, 150), bottle(NOW, 120)]), 120);
  assert.equal(usualBottle([bottle(NOW, 150), bottle(NOW, 150), bottle(NOW, 90)]), 150);
});

test("fridge runs out when bottles outpace pumps", () => {
  const entries = [...Array.from({ length: 7 }, (_, i) => bottle(NOW - i * D - 3600_000, 400)), ...Array.from({ length: 7 }, (_, i) => pump(NOW - i * D - 7200_000, 300))];
  const f = milkForecast(500, entries, NOW);
  assert.equal(f.usePerDay, 400);
  assert.equal(f.pumpPerDay, 300);
  assert.equal(f.shortPerDay, 100);
  assert.ok(f.until && Math.abs(f.until - (NOW + 5 * D)) < 60_000);
});

test("pumping that keeps up has no run-out date", () => {
  const entries = [bottle(NOW - D, 100), pump(NOW - D, 200)];
  assert.equal(milkForecast(300, entries, NOW).until, null);
});

test("pump insights split morning and night and notice a drop", () => {
  const last = [pump(Date.UTC(2026, 9, 12, 3, 0), 200), pump(Date.UTC(2026, 9, 12, 18, 0), 100)];
  const prev = [pump(Date.UTC(2026, 9, 4, 3, 0), 300), pump(Date.UTC(2026, 9, 4, 18, 0), 300)];
  const p = pumpInsights([...last, ...prev], "Asia/Dubai", NOW);
  assert.equal(p.morning, 200);
  assert.equal(p.night, 100);
  assert.equal(p.dropping, true);
});

test("thaw plan picks the oldest freezer bags until tomorrow is covered", () => {
  const entries = [bottle(NOW - D, 120), bottle(NOW - D, 120), bottle(NOW - 2 * D, 120)];
  const bottles = [bag("f1", "fridge", 100, 1), bag("z-new", "freezer", 150, 2), bag("z-old", "freezer", 150, 10), bag("z-gone", "freezer", 150, 200, true)];
  // 8 h away, a bottle every 2 h → 4 × 120 = 480 ml; 100 in the fridge → two bags, oldest first.
  const plan = thawPlan(bottles, entries, { awayTomorrow: true, awayMinutes: 480, intervalMin: 120, hour: 19 })!;
  assert.equal(plan.need, 480);
  assert.deepEqual(plan.picks.map((b) => b.id), ["z-old", "z-new"]);
  assert.equal(plan.short, 80);
  assert.equal(thawPlan(bottles, entries, { awayTomorrow: false, awayMinutes: 480, intervalMin: 120, hour: 19 }), null);
  assert.equal(thawPlan(bottles, entries, { awayTomorrow: true, awayMinutes: 480, intervalMin: 120, hour: 9 }), null);
});
