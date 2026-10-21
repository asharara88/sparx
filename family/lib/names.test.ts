import { test } from "node:test";
import assert from "node:assert/strict";
import { childName, childPronouns, possessive, pronouns } from "./names.ts";

const me = {
  subjects: [
    { id: "c", module_id: "lana", kind: "child" as const, name: "Omar", birth_date: "2026-10-01", names: { ar: "عمر" }, sex: "Boy" },
  ],
};

test("names come from the subjects, in the member's language when given", () => {
  assert.equal(childName(me), "Omar");
  assert.equal(childName(me, "ar"), "عمر");
  assert.equal(childName(me, "ru"), "Omar");
  assert.equal(childName({ subjects: [] }), "the baby");
  assert.equal(childName(undefined), "the baby");
});

test("possessive and pronouns", () => {
  assert.equal(possessive("Lana"), "Lana's");
  assert.equal(possessive("James"), "James'");
  assert.deepEqual(pronouns("Girl"), { they: "she", them: "her", their: "her", is: "is" });
  assert.equal(childPronouns(me).they, "he");
  assert.equal(pronouns(null).they, "they");
  assert.equal(pronouns(undefined).is, "are");
});
