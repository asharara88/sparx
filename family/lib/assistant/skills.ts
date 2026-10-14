import type { AssistantSkill } from "./skill-types";

/**
 * The skill router. Skills live in the database (assistant_skills) and the
 * router decides, before the model is called, which ones this question needs:
 * the always-on ones (how to coach, red flags) plus up to MAX_ROUTED matched by
 * trigger words in the question and the last couple of user turns. The model
 * can still pull any other skill from the index with load_skill.
 *
 * Pure: no I/O, so it is unit-tested with phrasings in all three languages.
 */

export const MAX_ROUTED = 4;

/** Skills that usually travel together: when the key is picked, the value is offered too if there is room. */
const RELATED: Record<string, string[]> = {
  regressions: ["sleep"],
  growth_spurts: ["feeding"],
  habits: ["sleep"],
  illness: ["feeding"],
  crying: ["sleep"],
};

/** Reach of the age gate: a skill still applies this many days outside its band (questions come early and late). */
const AGE_MARGIN_DAYS = 21;

const LATIN = /^[\x00-\x7F]+$/;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A trigger matches as a word prefix for Latin text ("nap" hits "naps", "constipat" hits "constipated") and as a substring otherwise. */
export function triggerMatches(trigger: string, text: string): boolean {
  const t = trigger.trim().toLowerCase();
  if (!t) return false;
  if (LATIN.test(t)) return new RegExp(`(^|[^a-z0-9])${escapeRe(t)}`, "i").test(text);
  return text.includes(t);
}

function inAge(skill: AssistantSkill, ageDays: number | null | undefined): boolean {
  if (ageDays == null) return true;
  if (skill.age_from_days != null && ageDays < skill.age_from_days - AGE_MARGIN_DAYS) return false;
  if (skill.age_to_days != null && ageDays > skill.age_to_days + AGE_MARGIN_DAYS) return false;
  return true;
}

export interface SelectOptions {
  /** The child's age in days; skills outside their band (plus a margin) are not routed. */
  ageDays?: number | null;
  /** Earlier user turns, newest last; they count for less than the question itself. */
  history?: string[];
  max?: number;
}

export interface Selection {
  /** Always-on skills, in sort order. */
  core: AssistantSkill[];
  /** Routed skills, best match first. */
  routed: AssistantSkill[];
}

/** Score a skill against a text: distinct triggers hit, phrases counting double. */
function score(skill: AssistantSkill, text: string): number {
  let s = 0;
  for (const trig of skill.triggers) if (triggerMatches(trig, text)) s += trig.includes(" ") ? 2 : 1;
  return s;
}

export function selectSkills(question: string, skills: AssistantSkill[], opts: SelectOptions = {}): Selection {
  const active = skills.filter((s) => s.is_active);
  const core = active.filter((s) => s.always_on).sort((a, b) => a.sort - b.sort);
  const q = question.toLowerCase();
  const h = (opts.history ?? []).slice(-2).join(" \n ").toLowerCase();
  const max = opts.max ?? MAX_ROUTED;

  const scored = active
    .filter((s) => !s.always_on && inAge(s, opts.ageDays))
    .map((s) => ({ s, score: score(s, q) * 2 + (h ? score(s, h) : 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.s.sort - b.s.sort);

  const routed: AssistantSkill[] = [];
  const push = (s: AssistantSkill) => {
    if (routed.length < max && !routed.some((r) => r.id === s.id)) routed.push(s);
  };
  for (const x of scored) push(x.s);
  // Companions, only while there is room: they never displace a direct match.
  for (const x of scored) for (const id of RELATED[x.s.id] ?? []) {
    const rel = active.find((s) => s.id === id && !s.always_on && inAge(s, opts.ageDays));
    if (rel) push(rel);
  }
  return { core, routed };
}

/** The index the model sees in the cached block: one line per skill, so it can ask for one by id. */
export function skillIndex(skills: AssistantSkill[]): string {
  const lines = skills.filter((s) => s.is_active && !s.always_on).sort((a, b) => a.sort - b.sort).map((s) => `- ${s.id}: ${s.title}. ${s.when}`);
  return lines.length ? `Skills you can read with load_skill (the ones this question needs are already below under SKILLS IN USE):\n${lines.join("\n")}` : "";
}

export function skillText(s: AssistantSkill): string {
  return `## ${s.title}${s.sources ? ` (${s.sources})` : ""}\n${s.body.trim()}`;
}

/** The always-on skills, for the cached block. */
export function coreBlock(core: AssistantSkill[]): string {
  return core.map(skillText).join("\n\n");
}

/** The routed skills, for the per-question block. Empty string when none. */
export function routedBlock(routed: AssistantSkill[]): string {
  return routed.length ? `SKILLS IN USE for this question:\n\n${routed.map(skillText).join("\n\n")}` : "";
}
