import { test } from "node:test";
import assert from "node:assert/strict";
import { selectSkills, skillIndex, triggerMatches } from "./skills.ts";
import type { AssistantSkill } from "./skill-types.ts";

const mk = (id: string, triggers: string[], extra: Partial<AssistantSkill> = {}): AssistantSkill => ({
  id,
  title: id,
  when: `about ${id}`,
  triggers,
  body: `body of ${id} that is long enough`,
  sources: "test",
  always_on: false,
  age_from_days: null,
  age_to_days: null,
  sort: 100,
  is_active: true,
  ...extra,
});

const SKILLS: AssistantSkill[] = [
  mk("coaching", [], { always_on: true, sort: 1 }),
  mk("red_flags", [], { always_on: true, sort: 2 }),
  mk("sleep", ["sleep", "nap", "naps", "bedtime", "night", "wake", "نوم", "تنام", "قيلولة", "спит", "сон"], { sort: 10 }),
  mk("safe_sleep", ["safe sleep", "cot", "swaddle", "our bed", "pillow"], { sort: 11 }),
  mk("regressions", ["regression", "suddenly", "leap", "4 month"], { sort: 12, age_from_days: 60, age_to_days: 600 }),
  mk("growth_spurts", ["growth spurt", "cluster feed", "every hour", "hungrier"], { sort: 13, age_to_days: 400 }),
  mk("feeding", ["feed", "feeds", "bottle", "ml", "breastfeed", "رضاعة", "кормить"], { sort: 14 }),
  mk("teething", ["teeth", "tooth", "teething", "gums", "drool", "أسنان", "зубы"], { sort: 17, age_from_days: 90, age_to_days: 900 }),
  mk("illness", ["fever", "temperature", "vomit", "constipat", "حرارة", "температура"], { sort: 20 }),
  mk("solids", ["solid", "solids", "weaning", "puree"], { sort: 16, age_from_days: 100, age_to_days: 548 }),
];

test("trigger matching: word prefix for Latin, substring for Arabic and Russian", () => {
  assert.equal(triggerMatches("nap", "her naps are short"), true);
  assert.equal(triggerMatches("nap", "a kidnapping film"), false);
  assert.equal(triggerMatches("constipat", "is she constipated?"), true);
  assert.equal(triggerMatches("our bed", "she sleeps in our bed"), true);
  assert.equal(triggerMatches("نوم", "هي ما تنام، النوم صعب"), true);
  assert.equal(triggerMatches("спит", "она плохо спит ночью"), true);
  assert.equal(triggerMatches("", "anything"), false);
});

test("always-on skills come with every question; routed ones only when triggered", () => {
  const sel = selectSkills("who is home today?", SKILLS);
  assert.deepEqual(sel.core.map((s) => s.id), ["coaching", "red_flags"]);
  assert.deepEqual(sel.routed, []);
});

test("a sleep question routes sleep; phrases weigh more than single words", () => {
  const a = selectSkills("Her naps are 30 minutes and bedtime is a fight", SKILLS, { ageDays: 120 });
  assert.equal(a.routed[0].id, "sleep");
  const b = selectSkills("Is it a growth spurt? She feeds every hour", SKILLS, { ageDays: 45 });
  assert.equal(b.routed[0].id, "growth_spurts");
  assert.ok(b.routed.some((s) => s.id === "feeding"), "feeding travels with growth spurts");
});

test("age gates: teething is not routed for a 3-week-old, solids not for a 2-month-old", () => {
  assert.deepEqual(selectSkills("is she teething? lots of drool", SKILLS, { ageDays: 21 }).routed.map((s) => s.id), []);
  assert.deepEqual(selectSkills("is she teething? lots of drool", SKILLS, { ageDays: 150 }).routed.map((s) => s.id), ["teething"]);
  assert.deepEqual(selectSkills("can we start solids?", SKILLS, { ageDays: 60 }).routed.map((s) => s.id), []);
  assert.deepEqual(selectSkills("can we start solids?", SKILLS, { ageDays: 85 }).routed.map((s) => s.id), ["solids"], "a margin lets early questions through");
  assert.equal(selectSkills("is she teething?", SKILLS).routed.length, 1, "no age known: no gate");
});

test("Arabic and Russian questions route the same skills", () => {
  assert.equal(selectSkills("ما تنام بالليل، كل ساعة تصحى", SKILLS, { ageDays: 120 }).routed[0].id, "sleep");
  assert.equal(selectSkills("у нее температура 38", SKILLS, { ageDays: 120 }).routed[0].id, "illness");
  assert.equal(selectSkills("طلعت لها أسنان؟", SKILLS, { ageDays: 200 }).routed[0].id, "teething");
});

test("follow-ups use the last user turns: 'and at night?' after a feeding question keeps feeding", () => {
  const sel = selectSkills("and at night?", SKILLS, { ageDays: 120, history: ["how many ml should a bottle be"] });
  assert.ok(sel.routed.some((s) => s.id === "feeding"));
  assert.ok(sel.routed.some((s) => s.id === "sleep"));
});

test("the cap holds and direct matches beat companions", () => {
  const sel = selectSkills("sleep regression, teething, fever and a bottle at bedtime, suddenly", SKILLS, { ageDays: 150, max: 3 });
  assert.equal(sel.routed.length, 3);
  assert.ok(sel.routed.every((s) => ["sleep", "regressions", "teething", "illness", "feeding"].includes(s.id)));
});

test("inactive skills are never routed and never indexed", () => {
  const skills = [...SKILLS, mk("old", ["sleep"], { is_active: false })];
  assert.ok(!selectSkills("sleep", skills).routed.some((s) => s.id === "old"));
  assert.ok(!skillIndex(skills).includes("old:"));
  assert.ok(skillIndex(skills).includes("- sleep: sleep. about sleep"));
});
