import { test } from "node:test";
import assert from "node:assert/strict";
import { recapOf, recapsBlock, selectMemories, words } from "./memory.ts";

const fact = (i: number, body: string) => ({ id: `m${i}`, body });

test("words: lowercases, drops stop words and the names", () => {
  assert.deepEqual(words("When did Lana last feed? She likes a warm bottle"), ["last", "feed", "likes", "warm", "bottle"]);
  assert.deepEqual(words("هل تنام جيداً"), ["هل", "تنام", "جيدا"]);
});

test("few facts: all of them, in order", () => {
  const facts = [fact(1, "White noise helps her settle."), fact(2, "Wafa likes short answers.")];
  assert.deepEqual(selectMemories("anything", [], facts), facts);
});

test("many facts: the relevant ones first, then the newest", () => {
  const facts = Array.from({ length: 40 }, (_, i) => fact(i, `Fact number ${i} about the house.`));
  facts[3] = fact(3, "She naps best in the pram after a walk.");
  facts[37] = fact(37, "The bottle warmer is in the top cupboard.");
  const picked = selectMemories("why are her naps so short?", [], facts, 5);
  assert.equal(picked[0].id, "m3", "the nap fact wins on words");
  assert.equal(picked.length, 5);
  assert.ok(picked.slice(1).every((f) => Number(f.id.slice(1)) <= 4), "the rest are the newest (the list is newest first)");
  const follow = selectMemories("and at night?", ["is the bottle warmer working"], facts, 3);
  assert.equal(follow[0].id, "m37", "the last turn counts for follow-ups");
});

test("recapOf: first question and the first sentence or two of the answer, citations gone", () => {
  const r = recapOf("Why are her naps so short?", "At 4 months 30 to 45 minute naps are one sleep cycle [entry:abc123]. Try settling her again at the first stir. Give it a week.");
  assert.equal(r, "Why are her naps so short? → At 4 months 30 to 45 minute naps are one sleep cycle. Try settling her again at the first stir.");
  const long = recapOf("x", "word ".repeat(100));
  assert.ok(long.length <= 400 && long.endsWith("…"));
});

test("recapsBlock lists newest first and skips chats without a recap", () => {
  const block = recapsBlock(
    [
      { id: "a", title: "Naps", summary: "Why short naps? → one sleep cycle; settle at the first stir.", at: "2026-10-14T10:00:00Z" },
      { id: "b", title: "x", summary: null, at: "2026-10-13T10:00:00Z" },
    ],
    (iso) => iso.slice(0, 10),
  );
  assert.equal(block.split("\n").length, 2);
  assert.ok(block.includes("- 2026-10-14: Why short naps?"));
  assert.equal(recapsBlock([], () => ""), "");
});
