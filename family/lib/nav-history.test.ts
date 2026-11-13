import { test } from "node:test";
import assert from "node:assert/strict";

test("Back goes back only while an app screen lies behind, and never out of the app", async () => {
  const { notePath, cameFromApp } = await import(`./nav-history.ts?${Math.random()}`);
  // Opened from outside on When to call: nothing behind it.
  notePath("/baby/when-to-call");
  assert.equal(cameFromApp("/baby/when-to-call"), false);
  // Into a topic: When to call is behind it.
  notePath("/baby/when-to-call/feeds");
  assert.equal(cameFromApp("/baby/when-to-call/feeds"), true);
  // Back to When to call: the visit's first screen again, so its Back uses the fallback.
  notePath("/baby/when-to-call");
  assert.equal(cameFromApp("/baby/when-to-call"), false);
  // On from there: About her, Vaccines; Back from Vaccines goes back.
  notePath("/baby");
  notePath("/baby/vaccines");
  assert.equal(cameFromApp("/baby/vaccines"), true);
});
