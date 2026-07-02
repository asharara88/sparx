import { describe, it, expect, beforeEach } from 'vitest';
import { decideMode, disclosureFor, requiredDisclosureLines, buildTechBrief, TECH_SECTION_ID } from '../src/skills/techSegment.js';
import { techSegmentPlanner } from '../src/agents/techSegmentPlanner.js';
import { scriptwriter } from '../src/agents/scriptwriter.js';
import { visualDirector } from '../src/agents/visualDirector.js';
import { qa } from '../src/agents/qa.js';
import { newEpisodeState, type TechSegment } from '../src/types/episode.js';
import { __setLLM } from '../src/llm/client.js';
import { ctxFor } from './helpers.js';

beforeEach(() => __setLLM(null));

const sig = (over: Partial<Parameters<typeof decideMode>[0]> = {}) => ({
  specific_product_exists: false, gulf_available: false, claims_testable: false,
  regulatory_murky: false, category_or_concept: false, ...over,
});

function techSeg(over: Partial<TechSegment> = {}): TechSegment {
  return {
    enabled: true, mode: 'spotlight', topic: 'Oura Ring 4', tie_in: 'measures the thing the episode is about',
    product: { name: 'Oura Ring 4', category: 'wearable', gulf_availability: 'Amazon.ae' },
    candidates: [], signals: sig({ specific_product_exists: true, gulf_available: true, claims_testable: true }),
    decision_trace: 't', sponsored: false, disclosure: disclosureFor(false), ...over,
  };
}

describe('mode rubric (deterministic)', () => {
  it('named product + gulf available + testable → spotlight', () => {
    expect(decideMode(sig({ specific_product_exists: true, gulf_available: true, claims_testable: true })).mode).toBe('spotlight');
  });
  it('regulatory murkiness ALWAYS forces explainer, even for a perfect product', () => {
    expect(decideMode(sig({ specific_product_exists: true, gulf_available: true, claims_testable: true, regulatory_murky: true })).mode).toBe('explainer');
  });
  it('category/concept → explainer', () => {
    expect(decideMode(sig({ category_or_concept: true })).mode).toBe('explainer');
  });
  it('product exists but not gulf-available or untestable → hybrid', () => {
    expect(decideMode(sig({ specific_product_exists: true, gulf_available: false, claims_testable: true })).mode).toBe('hybrid');
    expect(decideMode(sig({ specific_product_exists: true, gulf_available: true, claims_testable: false })).mode).toBe('hybrid');
  });
  it('no signals → explainer (safety default)', () => {
    expect(decideMode(sig()).mode).toBe('explainer');
  });
});

describe('disclosure', () => {
  it('sponsored vs independent copy differ and both carry ar + en', () => {
    const paid = disclosureFor(true); const indep = disclosureFor(false);
    expect(paid.en).toMatch(/paid/i); expect(indep.en).toMatch(/nobody paid/i);
    expect(paid.ar.length).toBeGreaterThan(4); expect(indep.ar.length).toBeGreaterThan(4);
  });
  it('required lines follow channel languages', () => {
    const ts = techSeg();
    expect(requiredDisclosureLines(ts, ['en'])).toEqual([ts.disclosure.en]);
    expect(requiredDisclosureLines(ts, ['ar'])).toEqual([ts.disclosure.ar]);
    expect(requiredDisclosureLines(ts, ['ar', 'en'])).toHaveLength(2);
  });
  it('brief demands the tech section id and the verbatim disclosure line', () => {
    const b = buildTechBrief(techSeg(), ['en']);
    expect(b).toContain(`"id":"${TECH_SECTION_ID}"`);
    expect(b).toContain(disclosureFor(false).en);
  });
});

describe('tech_segment_planner (auto-run)', () => {
  it('plans a segment from the concept and writes an audit trail', async () => {
    const s = newEpisodeState('t1');
    s.concept.topic = 'why your deep sleep collapses in summer';
    s.concept.angle = 'AC settings vs sleep stages'; s.concept.audience = 'Gulf professionals';
    const r = await techSegmentPlanner.run(ctxFor(s));
    const ts = r.writes.tech_segment!;
    expect(ts.enabled).toBe(true);
    expect(['spotlight', 'explainer', 'hybrid']).toContain(ts.mode);
    expect(ts.candidates.length).toBeGreaterThan(0);
    expect(ts.decision_trace.length).toBeGreaterThan(8);
    expect(ts.disclosure.en).toMatch(/nobody paid/i);
  });
  it('refuses to run without a concept', async () => {
    await expect(techSegmentPlanner.run(ctxFor(newEpisodeState('t2')))).rejects.toThrow(/no concept/);
  });
});

describe('scriptwriter tech-slot guarantee', () => {
  it('always populates the tech section with the disclosure line (deterministic fallback)', async () => {
    const s = newEpisodeState('t3');
    s.concept.topic = 'sleep in summer heat'; s.concept.angle = 'a'.repeat(10); s.concept.audience = 'x';
    s.tech_segment = techSeg();
    const r = await scriptwriter.run(ctxFor(s));
    const tech = r.writes.script!.sections.find((x) => x.id === TECH_SECTION_ID);
    expect(tech).toBeTruthy();
    expect(tech!.vo_text).toContain(disclosureFor(false).en);
  });
  it('leaves scripts untouched when the segment is disabled', async () => {
    const s = newEpisodeState('t4');
    s.concept.topic = 'sleep in summer heat'; s.concept.angle = 'a'.repeat(10); s.concept.audience = 'x';
    const r = await scriptwriter.run(ctxFor(s));
    expect(r.writes.script!.sections.find((x) => x.id === TECH_SECTION_ID)).toBeUndefined();
  });
});

describe('visual director product backstop', () => {
  it('spotlight tech shots are never generated — even in voice_only mode, which forces generated elsewhere', async () => {
    const s = newEpisodeState('t5');
    s.channel.host_mode = 'voice_only';
    s.tech_segment = techSeg({ mode: 'spotlight' });
    s.script.sections = [
      { id: 's1', beat: 'open', vo_text: 'spoken line here', shot_note: 'note here', on_screen: 'caption', retention_device: 'loop' },
      { id: TECH_SECTION_ID, beat: 'tech spotlight', vo_text: 'spoken line here', shot_note: 'note here', on_screen: 'caption', retention_device: 'pi' },
    ];
    const r = await visualDirector.run(ctxFor(s));
    const shots = r.writes.shot_list!;
    expect(shots.find((sh) => sh.section_id === 's1')!.source).toBe('generated');           // voice_only did its thing
    expect(shots.find((sh) => sh.section_id === TECH_SECTION_ID)!.source).toBe('stock');    // backstop won
  });
  it('explainer tech shots may stay generated', async () => {
    const s = newEpisodeState('t6');
    s.channel.host_mode = 'voice_only';
    s.tech_segment = techSeg({ mode: 'explainer', product: null });
    s.script.sections = [{ id: TECH_SECTION_ID, beat: 'tech spotlight', vo_text: 'spoken line here', shot_note: 'note here', on_screen: 'caption', retention_device: 'pi' }];
    const r = await visualDirector.run(ctxFor(s));
    expect(r.writes.shot_list!.find((sh) => sh.section_id === TECH_SECTION_ID)!.source).toBe('generated');
  });
});

describe('qa tech enforcement', () => {
  function qaBase() {
    const s = newEpisodeState('t7');
    s.shot_list = [{ shot_id: 'sh1', section_id: TECH_SECTION_ID, source: 'stock', duration_s: 4, prompt: {}, selected_asset: null, cost_estimate_usd: 0 }];
    s.sourced_assets = [{ shot_id: 'sh1', type: 'stock', uri: 'u', license: 'pexels', cost_usd: 0 }];
    s.music = { track_uri: 'm', sfx: [], license: 'elevenlabs', cost_usd: 0 };
    return s;
  }
  it('blocks a missing disclosure line', async () => {
    const s = qaBase();
    s.tech_segment = techSeg();
    s.script.sections = [{ id: TECH_SECTION_ID, beat: 'tech spotlight', vo_text: 'specs specs specs.', shot_note: 'n', on_screen: 'o', retention_device: 'pi' }];
    const r = await qa.run(ctxFor(s));
    expect(r.writes.qa?.passed).toBe(false);
    expect(r.writes.qa?.blocking_issues.join(' ')).toMatch(/independence disclosure/);
  });
  it('blocks a sponsored segment without the PAID disclosure, even if the independence line is present', async () => {
    const s = qaBase();
    s.tech_segment = techSeg({ sponsored: true, disclosure: disclosureFor(true) });
    s.script.sections = [{ id: TECH_SECTION_ID, beat: 'tech spotlight', vo_text: `specs. ${disclosureFor(false).en}`, shot_note: 'n', on_screen: 'o', retention_device: 'pi' }];
    const r = await qa.run(ctxFor(s));
    expect(r.writes.qa?.passed).toBe(false);
    expect(r.writes.qa?.blocking_issues.join(' ')).toMatch(/legal requirement/);
  });
  it('blocks a generative render of the real product', async () => {
    const s = qaBase();
    s.tech_segment = techSeg({ mode: 'spotlight' });
    s.script.sections = [{ id: TECH_SECTION_ID, beat: 'tech spotlight', vo_text: `ok. ${disclosureFor(false).en}`, shot_note: 'n', on_screen: 'o', retention_device: 'pi' }];
    s.shot_list[0]!.source = 'generated';
    s.shot_list[0]!.prompt = { runway: 'x' };
    s.generated_video = [{ shot_id: 'sh1', model: 'runway', takes: ['u'], selected_uri: 'u', cost_usd: 0 }];
    s.sourced_assets = [];
    const r = await qa.run(ctxFor(s));
    expect(r.writes.qa?.passed).toBe(false);
    expect(r.writes.qa?.blocking_issues.join(' ')).toMatch(/generative render/);
  });
  it('passes a compliant tech segment', async () => {
    const s = qaBase();
    s.tech_segment = techSeg();
    s.script.sections = [{ id: TECH_SECTION_ID, beat: 'tech spotlight', vo_text: `specs. ${disclosureFor(false).en}`, shot_note: 'n', on_screen: 'o', retention_device: 'pi' }];
    const r = await qa.run(ctxFor(s));
    expect(r.writes.qa?.passed).toBe(true);
  });
});
