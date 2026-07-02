import type { EpisodeStatus, EpisodeState } from '../types/episode.js';

// Agents in a state run as ordered STAGES: agents within a stage run concurrently,
// stages run sequentially so later agents see earlier agents' writes. This encodes
// intra-state dependencies (Build-Spec §5.3): Visual Director needs the script;
// Music needs the voiceover duration.
export interface StateDef {
  stages: string[][];      // e.g. [['scriptwriter'], ['visual_director']]
  next: EpisodeStatus;
  gate?: 'A' | 'B' | 'C';
}

export const MACHINE: Record<EpisodeStatus, StateDef | null> = {
  draft:          { stages: [],                                          next: 'researching' },
  researching:    { stages: [['research'], ['tech_segment_planner']],   next: 'concept_review' },
  concept_review: { stages: [], next: 'scripting',     gate: 'A' },
  // fact_checker + visual_director both consume the finished script; they run in parallel
  // so factual problems surface at GATE B, before any generation money is spent.
  scripting:      { stages: [['scriptwriter'], ['fact_checker', 'visual_director']], next: 'script_review' },
  script_review:  { stages: [], next: 'generating',    gate: 'B' },
  // VO + video + stock in parallel; then music (needs voiceover.total_duration_s)
  // alongside the reconciler, which backfills stock for any shot whose planned
  // visual failed to generate — before assembly bakes in placeholder slates.
  generating:     { stages: [['voiceover', 'video_generation', 'avatar', 'asset_sourcing'], ['generation_reconciler', 'music']], next: 'assembling' },
  // captions needs only the editor's timeline + voiceover, so it runs alongside the
  // (slow) ffmpeg render; render_qc probes the rendered file before QA sees it.
  assembling:     { stages: [['editor'], ['captions', 'render'], ['render_qc']], next: 'qa' },
  qa:             { stages: [['qa']],                                    next: 'cut_review' },
  cut_review:     { stages: [], next: 'distributing',  gate: 'C' },
  // shorts plan + packaging in parallel; shorts_renderer cuts real clips; publishing
  // runs LAST so publish.shorts_posted reflects what was actually rendered, not the plan.
  distributing:   { stages: [['shorts', 'packaging'], ['shorts_renderer'], ['publishing']], next: 'published' },
  published:      null,
  failed:         null,
  on_hold:        null,
};

// Every agent name referenced by a stage must exist in the registry. Called by the
// Producer at construction so a typo is a startup error, not a mid-pipeline
// 'unknown agent' failure hours into a run.
export function validateMachine(agents: Record<string, unknown>): string[] {
  const problems: string[] = [];
  for (const [status, def] of Object.entries(MACHINE)) {
    if (!def) continue;
    for (const stage of def.stages) {
      for (const name of stage) {
        if (!(name in agents)) problems.push(`state '${status}' references unknown agent '${name}'`);
      }
    }
    if (!(def.next in MACHINE)) problems.push(`state '${status}' transitions to unknown state '${def.next}'`);
  }
  return problems;
}

// Hard guards before entering a state (Build-Spec §5.2).
export const GUARDS: Partial<Record<EpisodeStatus, (s: EpisodeState) => string | null>> = {
  generating: (s) => {
    if (!s.script.approved) return 'script not approved';
    if (s.shot_list.length === 0) return 'shot_list empty';
    const missing = s.shot_list.filter((sh) => sh.source === 'generated' && !sh.prompt.runway && !sh.prompt.kling && !sh.prompt.veo);
    if (missing.length) return `${missing.length} generated shots missing prompts`;
    return null;
  },
  distributing: (s) => {
    if (!s.edit.approved) return 'final cut not approved';
    if (!s.qa.passed) return 'QA not passed';
    return null;
  },
};
