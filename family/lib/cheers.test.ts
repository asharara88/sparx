import { test } from "node:test";
import assert from "node:assert/strict";

const TZ = "Asia/Dubai";
const TODAY = "2026-11-25";

test("the set words thank and notice; none measures, compares or asks for more", async () => {
  const { CHEER_WORDS, CHEER_REST, CHEER_MAX } = await import("./cheers.ts");
  for (const w of [...CHEER_WORDS, CHEER_REST]) {
    assert.ok(w.length <= CHEER_MAX);
    assert.doesNotMatch(w, /only|just|lost|missed|low|slept|bad|more|keep|!|\d/i);
  }
  assert.equal(CHEER_WORDS.length, 3);
});

test("what a cheer is for, in a few words", async () => {
  const { cheerFor } = await import("./cheers.ts");
  assert.equal(cheerFor({ about: "night", ref_day: "2026-11-24" }, TODAY, TZ), "last night");
  assert.equal(cheerFor({ about: "night", ref_day: "2026-11-22" }, TODAY, TZ), "Sunday night");
  assert.equal(cheerFor({ about: "day", ref_day: TODAY }, TODAY, TZ), "today");
  assert.equal(cheerFor({ about: "day", ref_day: "2026-11-24" }, TODAY, TZ), "yesterday");
  assert.equal(cheerFor({ about: "day", ref_day: "2026-11-21" }, TODAY, TZ), "Saturday");
  assert.equal(cheerFor({ about: "medal", ref_day: null, badge: "pump_goal", tier: 2 }, TODAY, TZ), "the Bronze medal");
  assert.equal(cheerFor({ about: "medal", ref_day: null, badge: "gone", tier: 9 }, TODAY, TZ), "a medal");
  assert.equal(cheerFor({ about: "log", ref_day: null, type_label: "Feed", occurred_at: "2026-11-24T23:10:00Z" }, TODAY, TZ), "the feed at 03:10");
  assert.equal(cheerFor({ about: "log", ref_day: null }, TODAY, TZ), "the entry");
});
