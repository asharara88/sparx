import { describe, it, expect } from 'vitest';
import { MACHINE, GUARDS } from '../src/producer/stateMachine.js';
import { newEpisodeState } from '../src/types/episode.js';

describe('state machine', () => {
  it('gates have no agents and a gate marker', () => {
    for (const g of ['concept_review', 'script_review', 'cut_review'] as const) {
      expect(MACHINE[g]?.stages.flat().length).toBe(0);
      expect(MACHINE[g]?.gate).toBeTruthy();
    }
  });
  it('generating guard blocks when shot_list empty', () => {
    const s = newEpisodeState('t');
    s.script.approved = true;
    expect(GUARDS.generating!(s)).toMatch(/shot_list empty/);
  });
  it('generating guard passes with approved script + prompted generated shots', () => {
    const s = newEpisodeState('t');
    s.script.approved = true;
    s.shot_list = [{ shot_id: 'sh1', section_id: 's1', source: 'generated', duration_s: 4, prompt: { runway: 'x' }, selected_asset: null, cost_estimate_usd: 0 }];
    expect(GUARDS.generating!(s)).toBeNull();
  });
  it('distributing guard requires approved cut + qa pass', () => {
    const s = newEpisodeState('t');
    expect(GUARDS.distributing!(s)).toMatch(/cut|QA/);
  });
});
