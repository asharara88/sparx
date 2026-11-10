import { test } from "node:test";
import assert from "node:assert/strict";

test("milkSource: freezer milk from the freezer, pumped from the fridge, formula and unnamed from nowhere", async () => {
  const { milkSource } = await import("./milk-take.ts");
  assert.equal(milkSource({ method: "Bottle", amount_ml: 120, milk: "Freezer" }), "freezer");
  assert.equal(milkSource({ method: "Bottle", amount_ml: 120, milk: "Morning pumped" }), "fridge");
  assert.equal(milkSource({ method: "Bottle", amount_ml: 120, milk: "Night pumped" }), "fridge");
  assert.equal(milkSource({ method: "Bottle", amount_ml: 120, milk: "Formula" }), null);
  assert.equal(milkSource({ method: "Bottle", amount_ml: 120 }), null, "no milk named: nothing is guessed");
  assert.equal(milkSource({ method: "Breast", side: "Left" }), null);
  assert.equal(milkSource({ method: "Bottle", milk: "Freezer" }), null, "no amount, nothing to take");
});

test("shortLine: says so only when the stash ran short", async () => {
  const { shortLine } = await import("./milk-take.ts");
  assert.equal(shortLine("freezer", 40), "The freezer was 40 ml short.");
  assert.equal(shortLine("fridge", 0), null);
});
