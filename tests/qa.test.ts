import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { qa } from '../src/agents/qa.js';
import { newEpisodeState } from '../src/types/episode.js';
import { __setLLM, type LLM, type CompleteArgs, type CompleteResult } from '../src/llm/client.js';
import { ctxFor } from './helpers.js';

beforeEach(() => __setLLM(null));
afterEach(() => __setLLM(null));

function base() {
  const s = newEpisodeState('qa1');
  s.script.hook = 'One weird render pipeline';
  s.script.sections = [{ id: 's1', beat: 'open', vo_text: 'Plain narration with no claims.', shot_note: '', on_screen: '', retention_device: '' }];
  s.shot_list = [{ shot_id: 'sh1', section_id: 's1', source: 'generated', duration_s: 4, prompt: { runway: 'x' }, selected_asset: null, cost_estimate_usd: 0 }];
  s.generated_video = [{ shot_id: 'sh1', model: 'runway', takes: ['u'], selected_uri: 'u', cost_usd: 0 }];
  s.music = { track_uri: 'm', sfx: [], license: 'epidemic', cost_usd: 0 };
  return s;
}

function reviewLLM(data: unknown): LLM {
  return {
    live: true,
    async complete<T>(_args: CompleteArgs<T>): Promise<CompleteResult<T>> {
      return { text: JSON.stringify(data), data: data as T, usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.001 }, live: true };
    },
    totalUsage: () => ({ inputTokens: 0, outputTokens: 0, costUsd: 0 }),
  };
}
const throwingLLM: LLM = {
  live: true,
  complete: async () => { throw new Error('anthropic 500'); },
  totalUsage: () => ({ inputTokens: 0, outputTokens: 0, costUsd: 0 }),
};

describe('qa', () => {
  it('passes a clean mock state and requires AI disclosure when generated video is used', async () => {
    const r = await qa.run(ctxFor(base()));
    expect(r.status).toBe('ok');
    expect(r.writes.qa?.passed).toBe(true);
    expect(r.writes.qa?.ai_disclosure_required).toBe(true);
    expect(r.writes.qa?.blocking_issues.length).toBe(0);
    // unverified render + unrun fact check are noted, never blocking
    expect(r.writes.qa?.brand_checks.join(' ')).toMatch(/render unverified/);
    expect(r.writes.qa?.fact_checks.join(' ')).toMatch(/fact check not run/);
  });

  it('blocks when a shot has no visual', async () => {
    const s = base();
    s.shot_list.push({ shot_id: 'sh2', section_id: 's2', source: 'stock', duration_s: 4, prompt: {}, selected_asset: null, cost_estimate_usd: 0 });
    const r = await qa.run(ctxFor(s));
    expect(r.writes.qa?.passed).toBe(false);
    expect(r.writes.qa?.blocking_issues.join(' ')).toMatch(/without a visual/);
  });

  it('blocks on an unrecognized asset license', async () => {
    const s = base();
    s.shot_list.push({ shot_id: 'sh2', section_id: 's2', source: 'stock', duration_s: 4, prompt: {}, selected_asset: null, cost_estimate_usd: 0 });
    s.sourced_assets = [{ shot_id: 'sh2', type: 'stock', uri: 'a', license: 'unknown', cost_usd: 0 }];
    const r = await qa.run(ctxFor(s));
    expect(r.writes.qa?.passed).toBe(false);
    expect(r.writes.qa?.blocking_issues.join(' ')).toMatch(/license 'unknown' not recognized/);
  });

  it('accepts mock and pexels license families', async () => {
    const s = base();
    s.shot_list.push(
      { shot_id: 'sh2', section_id: 's2', source: 'stock', duration_s: 4, prompt: {}, selected_asset: null, cost_estimate_usd: 0 },
      { shot_id: 'sh3', section_id: 's3', source: 'stock', duration_s: 4, prompt: {}, selected_asset: null, cost_estimate_usd: 0 },
    );
    s.sourced_assets = [
      { shot_id: 'sh2', type: 'stock', uri: 'a', license: 'mock-stock-license', cost_usd: 0 },
      { shot_id: 'sh3', type: 'stock', uri: 'b', license: 'Pexels License', cost_usd: 0 },
    ];
    const r = await qa.run(ctxFor(s));
    expect(r.writes.qa?.passed).toBe(true);
    expect(r.writes.qa?.license_checks.join(' ')).toMatch(/2\/2 assets licensed/);
  });

  it('blocks on unsupported fact-check claims, naming them', async () => {
    const s = base();
    s.fact_check = { checked: true, claims: [{ claim: 'The moon is cheese', verdict: 'unsupported', source: 'https://x', note: 'refuted' }], unsupported_count: 1 };
    const r = await qa.run(ctxFor(s));
    expect(r.writes.qa?.passed).toBe(false);
    expect(r.writes.qa?.blocking_issues.join(' ')).toMatch(/unsupported claims: The moon is cheese/);
  });

  it('does not block on uncertain fact-check verdicts', async () => {
    const s = base();
    s.fact_check = { checked: true, claims: [{ claim: 'GDP grew 3%', verdict: 'uncertain', source: '', note: 'no live evidence' }], unsupported_count: 0 };
    const r = await qa.run(ctxFor(s));
    expect(r.writes.qa?.passed).toBe(true);
    expect(r.writes.qa?.fact_checks.join(' ')).toMatch(/uncertain: GDP grew 3%/);
  });

  it('blocks when render QC checked and failed, carrying its issues', async () => {
    const s = base();
    s.render_qc = { checked: true, passed: false, duration_s: 1, has_audio: false, width: 1280, height: 720, issues: ['render has no audio stream but narration exists'] };
    const r = await qa.run(ctxFor(s));
    expect(r.writes.qa?.passed).toBe(false);
    expect(r.writes.qa?.blocking_issues.join(' ')).toMatch(/render failed QC: .*no audio stream/);
  });

  it('flags narration without caption cues as non-blocking', async () => {
    const s = base();
    s.voiceover = { voice_id: 'v', clips: [{ section_id: 's1', audio_uri: 'a', duration_s: 5 }], total_duration_s: 5 };
    s.captions = { srt_uri: '', vtt_uri: '', cue_count: 0 };
    const r = await qa.run(ctxFor(s));
    expect(r.writes.qa?.passed).toBe(true);
    expect(r.writes.qa?.brand_checks.join(' ')).toMatch(/no caption cues/);
  });

  it('fails closed when the LLM review throws', async () => {
    __setLLM(throwingLLM);
    const r = await qa.run(ctxFor(base()));
    expect(r.status).toBe('ok');   // the gate holds via qa.passed, not an agent crash
    expect(r.writes.qa?.passed).toBe(false);
    expect(r.writes.qa?.blocking_issues).toContain('LLM review unavailable');
  });

  it('blocks when the LLM review flags a brand issue', async () => {
    __setLLM(reviewLLM({ claims_ok: true, brand_ok: false, issues: ['hype-heavy phrasing'] }));
    const r = await qa.run(ctxFor(base()));
    expect(r.writes.qa?.passed).toBe(false);
    expect(r.writes.qa?.blocking_issues.join(' ')).toMatch(/brand-voice issue/);
    expect(r.writes.qa?.brand_checks.join(' ')).toMatch(/hype-heavy phrasing/);
  });

  it('skips the paid LLM review when deterministic checks already block', async () => {
    __setLLM(throwingLLM);   // would fail closed if called
    const s = base();
    s.shot_list.push({ shot_id: 'sh2', section_id: 's2', source: 'stock', duration_s: 4, prompt: {}, selected_asset: null, cost_estimate_usd: 0 });
    const r = await qa.run(ctxFor(s));
    expect(r.writes.qa?.blocking_issues.join(' ')).toMatch(/without a visual/);
    expect(r.writes.qa?.blocking_issues).not.toContain('LLM review unavailable');
    expect(r.writes.qa?.brand_checks.join(' ')).toMatch(/LLM review skipped/);
  });

  it('fails the precondition on an empty shot list', async () => {
    const s = newEpisodeState('qa2');
    const r = await qa.run(ctxFor(s));
    expect(r.status).toBe('failed');
    expect(r.notes).toMatch(/no shot list/);
  });
});
