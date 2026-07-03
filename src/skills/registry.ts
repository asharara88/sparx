import type { Skill, SkillMeta } from './types.js';

// Runtime skill registry. Skills register at module-import time (side effect of
// importing src/skills/index.js); agents declare skill names in their spec and
// assertSkills() turns a typo'd declaration into a startup error instead of a
// mid-pipeline surprise.

const registry = new Map<string, Skill<any, any>>();

export function defineSkill<I, O>(spec: {
  name: string;
  description: string;
  live?: () => boolean;
  run: (input: I) => Promise<O>;
}): Skill<I, O> {
  const skill: Skill<I, O> = {
    name: spec.name,
    description: spec.description,
    live: spec.live ?? (() => true),
    run: spec.run,
  };
  if (registry.has(spec.name)) throw new Error(`skill '${spec.name}' registered twice`);
  registry.set(spec.name, skill);
  return skill;
}

export function getSkill<I = unknown, O = unknown>(name: string): Skill<I, O> {
  const s = registry.get(name);
  if (!s) throw new Error(`unknown skill '${name}' — is it registered in src/skills/index.ts?`);
  return s as Skill<I, O>;
}

export function hasSkill(name: string): boolean {
  return registry.has(name);
}

export function listSkills(): SkillMeta[] {
  return [...registry.values()].map(({ name, description }) => ({ name, description }));
}

/** Validate a set of declared skill names; returns the missing ones. */
export function missingSkills(names: string[]): string[] {
  return names.filter((n) => !registry.has(n));
}

// test seam
export function __clearSkills() { registry.clear(); }
