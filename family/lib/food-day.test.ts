import { test } from "node:test";
import assert from "node:assert/strict";
import { foodDay } from "./food-day.ts";

const day = Date.parse("2026-12-10T00:00:00Z");
const m = (iso: string, payload: Record<string, unknown>) => ({ occurred_at: iso, payload });

test("today's meals, new foods this week (newest first, once each), allergens in the order eaten, the last reaction", () => {
  const f = foodDay([
    m("2026-12-05T08:00:00Z", { food: "Avocado", new_food: "Yes", allergen: "None", reaction: "None" }),
    m("2026-12-07T08:00:00Z", { food: "Egg", new_food: "Yes", allergen: "Egg", reaction: "Rash" }),
    m("2026-12-08T08:00:00Z", { food: "avocado", new_food: "Yes", allergen: "None", reaction: "None" }),
    m("2026-12-09T08:00:00Z", { food: "Toast", new_food: "No", allergen: "Wheat", reaction: "None" }),
    m("2026-12-10T08:00:00Z", { food: "Porridge", new_food: "No", allergen: "Milk", reaction: "None" }),
    m("2026-12-10T12:00:00Z", { food: "Banana", new_food: "Yes" }),
  ], day, day + 86_400_000);
  assert.equal(f.today, 2);
  assert.deepEqual(f.newThisWeek, ["banana", "avocado", "egg"]);
  assert.deepEqual(f.allergens, ["egg", "wheat", "milk"]);
  assert.deepEqual(f.reaction, { food: "egg", reaction: "rash", at: "2026-12-07T08:00:00Z" });
});

test("no meals: zeros and nothing to list", () => {
  assert.deepEqual(foodDay([], day, day + 86_400_000), { today: 0, newThisWeek: [], allergens: [], reaction: null });
});
