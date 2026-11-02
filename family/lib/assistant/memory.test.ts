import { test } from "node:test";
import assert from "node:assert/strict";
import { chatDigest, memoriesBlock, recapOf, recapsBlock, selectMemories, withOutcomes, words } from "./memory.ts";

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

test("memories about the person asking are always kept past the cap; suggestions come last and are capped", () => {
  const facts = Array.from({ length: 40 }, (_, i) => fact(i, `Fact number ${i} about the house.`));
  facts[39] = { ...fact(39, "Wafa likes a short answer in Arabic."), kind: "person", about: { id: "wafa", name: "Wafa" } };
  const suggested = Array.from({ length: 8 }, (_, i) => ({ ...fact(100 + i, `Noticed thing ${i}.`), status: "suggested" as const }));
  const picked = selectMemories("anything about naps", [], [...facts, ...suggested], 5, [], "wafa");
  assert.equal(picked[0].id, "m39", "the asker's own memory comes first");
  assert.equal(picked.filter((f) => f.status !== "suggested").length, 5);
  assert.equal(picked.filter((f) => f.status === "suggested").length, 5, "at most five suggestions");
  assert.deepEqual(selectMemories("x", [], [fact(1, "a"), fact(2, "b")], 30), [fact(1, "a"), fact(2, "b")]);
});

test("memoriesBlock groups by what each memory is about, the asker first, suggestions marked", () => {
  const block = memoriesBlock(
    [
      { id: "aaaaaaaa-1", body: "No cry-it-out.", kind: "home" },
      { id: "bbbbbbbb-1", body: "Sleeps better with white noise.", kind: "child", subject: { id: "s1", name: "Lana" } },
      { id: "cccccccc-1", body: "Likes short answers.", kind: "person", about: { id: "p1", name: "Wafa" } },
      { id: "dddddddd-1", body: "Works 9 to 5.", kind: "person", about: { id: "p2", name: "Dana" } },
      { id: "eeeeeeee-1", body: "Maybe teething.", kind: "child", subject: { id: "s1", name: "Lana" }, status: "suggested" },
    ],
    { id: "p2", name: "Dana" },
  );
  const lines = block.split("\n");
  assert.ok(lines.indexOf("About the home:") < lines.indexOf("About Lana:"));
  assert.ok(lines.indexOf("About Dana (the person you are talking to):") < lines.indexOf("About Wafa:"), "the asker's group comes before the others");
  assert.ok(block.includes("- [aaaaaaaa] No cry-it-out."));
  assert.ok(/nobody has confirmed yet[^\n]*\n- \[eeeeeeee\] Maybe teething\./.test(block));
  assert.equal(memoriesBlock([], null), "");
});

test("withOutcomes tells the model what happened to each card", () => {
  const turns = withOutcomes(
    [
      { role: "user", text: "log a bottle" },
      { role: "assistant", text: "Prepared it.", proposals: [{ id: "p1", kind: "care_entry", summary: "Bottle 120 ml at 14:10" }, { id: "p2", kind: "memory", summary: "Remember: warm bottles" }] },
      { role: "assistant", text: "oops", error: true },
      { role: "assistant", text: "", streaming: true },
    ],
    { p1: { status: "saved", note: "Logged" }, p2: { status: "dropped" } },
  );
  assert.equal(turns.length, 2);
  assert.equal(turns[1].text, "Prepared it.\n[Confirmed and saved: Bottle 120 ml at 14:10]\n[Not saved: Remember: warm bottles]");
  assert.equal(withOutcomes([{ role: "assistant", text: "hi", proposals: [{ id: "p3", kind: "plan", summary: "A plan" }] }], {})[0].text, "hi\n[Not confirmed yet: A plan]");
});

test("chatDigest carries the cut part of a long chat as questions and what was saved", () => {
  const turns = Array.from({ length: 20 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", text: i % 2 ? `answer ${i}\n[Confirmed and saved: Bottle ${i} ml]` : `question ${i}` }));
  const d = chatDigest(turns, 14);
  assert.ok(d.startsWith("EARLIER IN THIS CHAT"));
  assert.ok(d.includes("- asked: question 0") && d.includes("- asked: question 4"));
  assert.ok(!d.includes("question 6"), "only the cut part");
  assert.ok(d.includes("- saved: Bottle 5 ml"));
  assert.equal(chatDigest(turns.slice(0, 14), 14), "");
});
