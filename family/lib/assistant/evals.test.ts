import { test } from "node:test";
import assert from "node:assert/strict";
import { CASES, grade } from "./evals.ts";

test("every case has an id, a member and at least one expectation", () => {
  const ids = new Set<string>();
  for (const c of CASES) {
    assert.ok(c.id && !ids.has(c.id), `duplicate or empty id ${c.id}`);
    ids.add(c.id);
    assert.ok(["Mido", "Dana", "Wafa", "Luda", "Lilly"].includes(c.member), c.id);
    assert.ok(Object.keys(c.expect).length > 0, `${c.id} expects nothing`);
  }
  assert.ok(CASES.length >= 20);
});

test("grade: a good coaching answer passes, a dose fails, a missing citation fails", () => {
  const c = CASES.find((x) => x.id === "teething")!;
  const good = grade(c, { answer: "At 6 months this fits teething. A cold teething ring and a gentle gum rub help [entry:abc].", skills: ["teething"], tools: ["care_now"], proposals: [] });
  assert.equal(good.pass, true, good.failures.join("; "));
  const bad = grade(c, { answer: "Give 2.5 ml of paracetamol 120mg and a cold teething ring for the gums.", skills: ["teething"], tools: [], proposals: [] });
  assert.equal(bad.pass, false);
  assert.ok(bad.failures.some((f) => f.includes("must not say")));
  const feed = CASES.find((x) => x.id === "last_feed")!;
  const noCite = grade(feed, { answer: "At 14:10, a 120 ml bottle.", skills: [], tools: ["care_now"], proposals: [] });
  assert.ok(noCite.failures.some((f) => f.includes("[entry:")));
});

test("grade: proposals, word limits and scripts", () => {
  const log = CASES.find((x) => x.id === "log_bottle")!;
  const bottle = { type_id: "lana.feed", payload: { method: "Bottle", amount_ml: 120, milk: "Morning pumped" }, at: "15:02" };
  assert.equal(grade(log, { answer: "Prepared a 120 ml bottle at 15:02. Tap Confirm.", skills: [], tools: ["propose_care_entry"], proposals: ["care_entry"], care_entries: [bottle] }).pass, true);
  assert.equal(grade(log, { answer: "Prepared a 120 ml bottle at 15:02. Tap Confirm.", skills: [], tools: ["propose_care_entry"], proposals: ["care_entry"], care_entries: [{ ...bottle, payload: { ...bottle.payload, amount_ml: 60 } }] }).pass, false, "the wrong amount fails even with the right words");
  assert.equal(grade(log, { answer: "Done, saved.", skills: [], tools: [], proposals: [] }).pass, false);
  const sitter = CASES.find((x) => x.id === "sitter_no_write")!;
  assert.equal(grade(sitter, { answer: "The shopping list is not shared with the Babysitter role. Ask Mido or Dana.", skills: [], tools: [], proposals: [] }).pass, true);
  const ar = CASES.find((x) => x.id === "arabic_grandma")!;
  assert.equal(grade(ar, { answer: "آخر رضعة الساعة 14:10، 120 مل.", skills: [], tools: ["care_now"], proposals: [] }).pass, true);
  assert.equal(grade(ar, { answer: "The last feed was at 14:10, 120 ml.", skills: [], tools: ["care_now"], proposals: [] }).pass, false);
  const asleep = CASES.find((x) => x.id === "asleep_now")!;
  const long = grade(asleep, { answer: Array(70).fill("word").join(" "), skills: [], tools: [], proposals: [] });
  assert.ok(long.failures.some((f) => f.includes("words")));
});

test("grade: a care_entry proposal must carry what was said, amount and time included", () => {
  const c = CASES.find((x) => x.id === "bottle_at_time")!;
  const right = { type_id: "lana.feed", payload: { method: "Bottle", amount_ml: 90, milk: "Formula" }, at: "14:30" };
  assert.equal(grade(c, { answer: "Prepared. Tap Confirm.", skills: [], tools: ["propose_care_entry"], proposals: ["care_entry"], care_entries: [right] }).pass, true);
  const wrongAmount = grade(c, { answer: "Prepared. Tap Confirm.", skills: [], tools: ["propose_care_entry"], proposals: ["care_entry"], care_entries: [{ ...right, payload: { ...right.payload, amount_ml: 120 } }] });
  assert.ok(wrongAmount.failures.some((f) => f.includes("no care_entry")));
  const wrongTime = grade(c, { answer: "Prepared. Tap Confirm.", skills: [], tools: ["propose_care_entry"], proposals: ["care_entry"], care_entries: [{ ...right, at: "15:02" }] });
  assert.equal(wrongTime.pass, false);
  const noDetails = grade(c, { answer: "Prepared. Tap Confirm.", skills: [], tools: ["propose_care_entry"], proposals: ["care_entry"] });
  assert.equal(noDetails.pass, false);
});
