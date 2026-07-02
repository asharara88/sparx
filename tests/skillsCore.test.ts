import { describe, expect, it } from 'vitest';
import { getSkill, hasSkill, listSkills, missingSkills } from '../src/skills/registry.js';
import '../src/skills/index.js';
import { validateRefs } from '../src/skills/referenceValidation.js';
import { estimateShotCost, estimateVoiceCost, estimateAvatarCost } from '../src/skills/costModel.js';
import { buildCues, chunkText, toSRT, toVTT } from '../src/skills/captioning.js';
import { buildAssetQuery, rankAssets } from '../src/skills/assetMatching.js';
import { checkCompliance } from '../src/skills/brandCompliance.js';
import { contentKey } from '../src/skills/artifactCache.js';
import { newEpisodeState } from '../src/types/episode.js';

describe('skill registry', () => {
  it('registers the core skill set', () => {
    for (const name of ['cost-model', 'reference-validation', 'artifact-cache', 'channel-memory', 'media-probe', 'captioning', 'brand-compliance', 'evidence-retrieval', 'asset-matching', 'video-clipping', 'web-research', 'seo-keywords']) {
      expect(hasSkill(name), `skill '${name}' should be registered`).toBe(true);
    }
    expect(listSkills().length).toBeGreaterThanOrEqual(12);
    expect(missingSkills(['cost-model', 'nope'])).toEqual(['nope']);
    expect(() => getSkill('nope')).toThrow(/unknown skill/);
  });
});

describe('reference validation', () => {
  it('reports unknown, unreferenced, and duplicate ids', () => {
    const r = validateRefs(['s1', 's2', 's3'], ['s1', 's1', 's9']);
    expect(r.ok).toBe(false);
    expect(r.unknown).toEqual(['s9']);
    expect(r.unreferenced).toEqual(['s2', 's3']);
    expect(r.duplicates).toEqual(['s1']);
    expect(validateRefs(['a'], ['a']).ok).toBe(true);
  });
});

describe('cost model', () => {
  it('prices media steps consistently', () => {
    expect(estimateShotCost(10, 'runway')).toBeCloseTo(0.5);
    expect(estimateAvatarCost(60)).toBeCloseTo(0.3);
    // the old voice estimate was ~1000x low; 1k chars must cost dollars-order, not fractions of a cent
    expect(estimateVoiceCost(1000)).toBeGreaterThan(0.1);
  });
});

describe('captioning', () => {
  it('chunks long text at word boundaries under the cue cap', () => {
    const text = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
    const chunks = chunkText(text);
    expect(chunks.every((c) => c.length <= 84)).toBe(true);
    expect(chunks.join(' ')).toBe(text); // no words lost or reordered
  });

  it('lays cues over section time ranges and renders valid SRT/VTT', () => {
    const cues = buildCues([
      { text: 'Hello world, this is the hook.', startS: 0, durationS: 4 },
      { text: 'Second section narration continues here.', startS: 4, durationS: 6 },
    ]);
    expect(cues.length).toBeGreaterThanOrEqual(2);
    expect(cues[0]!.startS).toBe(0);
    expect(cues.at(-1)!.endS).toBeLessThanOrEqual(10.01);
    const srt = toSRT(cues);
    expect(srt).toContain('1\n00:00:00,000 -->');
    expect(toVTT(cues).startsWith('WEBVTT')).toBe(true);
  });

  it('skips zero-duration sections instead of emitting instant cues', () => {
    expect(buildCues([{ text: 'ghost section', startS: 0, durationS: 0 }])).toEqual([]);
  });

  it('never produces overlapping cues, within or across sections', () => {
    // long texts over short spans force multi-chunk sections whose tiny trailing
    // chunks must merge into the previous cue instead of overflowing the boundary
    const wall = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `${tag}${i}word`).join(' ');
    const sections = [
      { text: wall(30, 'a'), startS: 0, durationS: 2.5 },
      { text: wall(25, 'b'), startS: 2.5, durationS: 1.2 },
      { text: wall(40, 'c'), startS: 3.7, durationS: 6.3 },
    ];
    const cues = buildCues(sections);
    expect(cues.length).toBeGreaterThan(3);
    for (const c of cues) expect(c.endS).toBeGreaterThan(c.startS);
    for (let i = 1; i < cues.length; i++) {
      expect(cues[i]!.startS, `cue ${i} must not start before cue ${i - 1} ends`).toBeGreaterThanOrEqual(cues[i - 1]!.endS - 1e-9);
    }
    expect(cues.at(-1)!.endS).toBeLessThanOrEqual(10 + 1e-9); // never past the last section boundary
  });
});

describe('asset matching', () => {
  it('builds queries from shot context, not filler words', () => {
    const q = buildAssetQuery({ shot_note: 'drone shot of a city skyline at dusk', beat: 'the stakes' });
    expect(q).toContain('city');
    expect(q).not.toMatch(/\bof\b|\bthe\b|\ba\b/);
  });

  it('ranks HD landscape footage with matching keywords first', () => {
    const ranked = rankAssets({
      query: 'city skyline dusk',
      targetDurationS: 8,
      candidates: [
        { uri: 'low', width: 640, height: 360, durationS: 3, description: 'blurry street' },
        { uri: 'best', width: 1920, height: 1080, durationS: 12, description: 'city skyline at dusk' },
        { uri: 'portrait', width: 720, height: 1280, durationS: 12, description: 'city skyline at dusk' },
      ],
    });
    expect(ranked[0]!.uri).toBe('best');
  });
});

describe('brand compliance', () => {
  it('fails on banned phrases and unknown licenses; passes clean mock state', () => {
    const clean = newEpisodeState('ep_bc');
    clean.script.sections = [{ id: 's1', beat: 'open', vo_text: 'A specific, concrete claim.', shot_note: '', on_screen: '', retention_device: '' }];
    expect(checkCompliance(clean).passed).toBe(true);

    const dirty = newEpisodeState('ep_bc2');
    dirty.script.hook = "In today's video we go on a deep dive";
    dirty.sourced_assets = [{ shot_id: 'sh1', type: 'stock', uri: 'x', license: 'unknown', cost_usd: 0 }];
    const report = checkCompliance(dirty);
    expect(report.passed).toBe(false);
    expect(report.banned_phrase_hits.length).toBeGreaterThan(0);
    expect(report.issues.some((i) => i.includes('license'))).toBe(true);
  });

  it('requires disclosure whenever synthetic media is present', () => {
    const s = newEpisodeState('ep_bc3');
    s.generated_video = [{ shot_id: 'sh1', model: 'runway', takes: [], selected_uri: 'x', cost_usd: 0 }];
    expect(checkCompliance(s).disclosure_required).toBe(true);
  });
});

describe('artifact cache keys', () => {
  it('is stable for identical inputs and distinct across inputs', () => {
    expect(contentKey('voice', 'v1', 'hello')).toBe(contentKey('voice', 'v1', 'hello'));
    expect(contentKey('voice', 'v1', 'hello')).not.toBe(contentKey('voice', 'v2', 'hello'));
  });
});
