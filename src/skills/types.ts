// Shared skills layer (Build-Spec §7). Thin agents call these reusable skills.
//
// A Skill is a named, typed capability with a uniform contract:
//   - `run(input)` does the work (may call providers, the LLM, ffmpeg, ...)
//   - `live` reports whether the skill is backed by a real provider or a mock,
//     so agents and QA can surface degraded output instead of silently passing.
// Skills self-register in the registry (src/skills/registry.ts) at import time;
// agents declare the skills they use in their spec (src/agents/core.ts) and the
// registry validates those declarations at startup.

export interface SkillMeta {
  name: string;
  description: string;
}

export interface Skill<I = unknown, O = unknown> extends SkillMeta {
  run(input: I): Promise<O>;
  /** true when a real provider backs this skill in the current config. */
  live(): boolean;
}

export interface Source { title: string; url: string }
