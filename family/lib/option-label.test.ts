import { test } from "node:test";
import assert from "node:assert/strict";
import { optionLabel } from "./i18n.ts";

test("optionLabel: the stored value stays, the words change; a field's own labels win", () => {
  assert.equal(optionLabel("en", "Formula"), "Formula");
  assert.equal(optionLabel("ar", "Formula"), "حليب صناعي");
  assert.equal(optionLabel("ru", "Morning pumped"), "Утреннее сцеженное");
  assert.equal(optionLabel("ru", "Goat milk"), "Goat milk", "an option with no words yet shows as stored");
  assert.equal(optionLabel("ar", "Formula", { labels: { ar: { Formula: "فورمولا" } } }), "فورمولا");
  assert.equal(optionLabel(undefined, "Formula"), "Formula");
});
