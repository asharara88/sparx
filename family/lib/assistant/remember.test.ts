import { test } from "node:test";
import assert from "node:assert/strict";
import { newCandidates, parseCandidates, rememberPrompt, shouldMine } from "./remember.ts";

test("a chat is read at two new questions, never earlier", () => {
  assert.equal(shouldMine(1, 0), false);
  assert.equal(shouldMine(2, 0), true);
  assert.equal(shouldMine(3, 2), false);
  assert.equal(shouldMine(4, 2), true);
});

test("parseCandidates takes the JSON array out of prose and drops the junk", () => {
  const out = parseCandidates('Here you go:\n```json\n[{"body":"Lana sleeps better with white noise.","kind":"child","about":"Lana"},{"body":"x","kind":"home"},{"body":"Dana likes short answers.","kind":"person","about":"Dana"},{"body":"Not a kind.","kind":"pet"},{"body":"Fourth one.","kind":"home"},{"body":"Fifth.","kind":"home"}]\n```');
  assert.deepEqual(out, [
    { body: "Lana sleeps better with white noise.", kind: "child", about: "Lana" },
    { body: "Dana likes short answers.", kind: "person", about: "Dana" },
    { body: "Fourth one.", kind: "home", about: null },
  ]);
  assert.deepEqual(parseCandidates("nothing here"), []);
  assert.deepEqual(parseCandidates("[not json"), []);
});

test("newCandidates drops what is already remembered, or said twice", () => {
  const out = newCandidates(
    [
      { body: "Lana sleeps better with white noise on.", kind: "child", about: "Lana" },
      { body: "Wafa prefers answers in Arabic.", kind: "person", about: "Wafa" },
      { body: "Wafa prefers her answers in Arabic, short.", kind: "person", about: "Wafa" },
    ],
    ["She sleeps better with the white noise on."],
  );
  assert.deepEqual(out.map((c) => c.body), ["Wafa prefers answers in Arabic."]);
  const updated = newCandidates([{ body: "Bedtime is 19:30 from Monday.", kind: "home" }, { body: "Bedtime is 19:00 from Monday.", kind: "home" }], ["Bedtime is 19:00 from Monday."]);
  assert.deepEqual(updated.map((c) => c.body), ["Bedtime is 19:30 from Monday."], "a changed number is an update, not a duplicate");
});

test("the reading prompt names the people, the children and what is already known", () => {
  const p = rememberPrompt({ people: ["Dana", "Wafa"], children: ["Lana"], existing: ["No cry-it-out."] });
  assert.ok(p.includes("Dana, Wafa") && p.includes("Lana") && p.includes('"No cry-it-out."'));
  assert.ok(rememberPrompt({ people: [], children: [], existing: [] }).includes("(nothing yet)"));
});
