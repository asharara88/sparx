import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { voiceover } from '../src/agents/voiceover.js';
import { __setVoice, type VoiceProvider } from '../src/media/voice.js';
import { newEpisodeState } from '../src/types/episode.js';
import { ctxFor } from './helpers.js';

// config() caches on first read; nothing in the import graph reads it at import
// time, so pointing the artifact cache at a fresh temp dir here isolates every run.
process.env.CACHE_DIR = mkdtempSync(join(tmpdir(), 'sparx-vo-cache-'));
process.env.ARTIFACT_CACHE = 'true';
delete process.env.ELEVENLABS_API_KEY;

afterEach(() => __setVoice(null));

function stateWith(texts: string[], id = 'vo1') {
  const s = newEpisodeState(id);
  s.script.sections = texts.map((t, i) => ({ id: `s${i + 1}`, beat: 'b', vo_text: t, shot_note: '', on_screen: '', retention_device: '' }));
  s.voiceover.voice_id = 'test-voice';
  return s;
}

describe('voiceover', () => {
  it('synthesizes sections in parallel and keeps clips in section order', async () => {
    let inFlight = 0; let maxInFlight = 0; let started = 0;
    const fake: VoiceProvider = {
      name: 'fake', live: false,
      async synthesize(text) {
        inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
        const delay = 40 - started++ * 10; // later sections finish first
        await new Promise((r) => setTimeout(r, delay));
        inFlight--;
        return { uri: `mock://voice/${encodeURIComponent(text)}.mp3`, durationS: 2, costUsd: 0, license: 'mock' };
      },
    };
    __setVoice(fake);
    const s = stateWith(['alpha one line', 'bravo two line', 'charlie three line', 'delta four line']);
    const r = await voiceover.run(ctxFor(s));
    expect(r.status).toBe('ok');
    expect(maxInFlight).toBeGreaterThan(1); // actually parallel, not a serial loop
    expect(r.writes.voiceover?.clips.map((c) => c.section_id)).toEqual(['s1', 's2', 's3', 's4']);
    expect(r.writes.voiceover?.clips[0]?.audio_uri).toContain('alpha');
    expect(r.writes.voiceover?.clips[3]?.audio_uri).toContain('delta');
    expect(r.writes.voiceover?.total_duration_s).toBe(8);
  });

  it('returns needs_human when more than half the sections fail', async () => {
    const fake: VoiceProvider = {
      name: 'fake', live: false,
      async synthesize(text) {
        if (!text.includes('keep')) throw new Error('tts outage');
        return { uri: 'mock://voice/kept.mp3', durationS: 3, costUsd: 0, license: 'mock' };
      },
    };
    __setVoice(fake);
    const r = await voiceover.run(ctxFor(stateWith(['keep this narration', 'first failing narration', 'second failing narration'])));
    expect(r.status).toBe('needs_human');
    expect(r.notes).toMatch(/2\/3/);
    expect(r.notes).toContain('s2');
    expect(r.writes.voiceover?.clips).toHaveLength(1); // successful clip still written for the rerun
  });

  it('skips failures at or below the threshold and names them in notes', async () => {
    const fake: VoiceProvider = {
      name: 'fake', live: false,
      async synthesize(text) {
        if (text.includes('broken')) throw new Error('tts outage');
        return { uri: `mock://voice/${encodeURIComponent(text)}.mp3`, durationS: 3, costUsd: 0, license: 'mock' };
      },
    };
    __setVoice(fake);
    const r = await voiceover.run(ctxFor(stateWith(['fine narration one', 'broken narration here', 'fine narration two'])));
    expect(r.status).toBe('ok');
    expect(r.writes.voiceover?.clips.map((c) => c.section_id)).toEqual(['s1', 's3']);
    expect(r.notes).toContain('skipped: s2');
  });

  it('re-runs hit the artifact cache: cost 0 and no provider re-billing', async () => {
    let calls = 0;
    const fake: VoiceProvider = {
      name: 'fake', live: false,
      async synthesize(text) {
        calls++;
        return { uri: `https://fake.test/voice/${encodeURIComponent(text)}.mp3`, durationS: 4, costUsd: 0.5, license: 'mock' };
      },
    };
    __setVoice(fake);
    const s = stateWith(['unique cacheable narration alpha', 'unique cacheable narration beta'], 'vo-cache');
    const r1 = await voiceover.run(ctxFor(s));
    expect(r1.status).toBe('ok');
    expect(r1.cost_usd).toBeCloseTo(1.0);
    expect(calls).toBe(2);
    const r2 = await voiceover.run(ctxFor(s));
    expect(r2.status).toBe('ok');
    expect(r2.cost_usd).toBe(0);
    expect(calls).toBe(2); // cache hit — synthesize never re-called
    expect(r2.writes.voiceover?.clips.map((c) => c.audio_uri)).toEqual(r1.writes.voiceover?.clips.map((c) => c.audio_uri));
    // hits keep the provider-measured duration from the cache, not the words/2.3 guess
    expect(r1.writes.voiceover?.clips.map((c) => c.duration_s)).toEqual([4, 4]);
    expect(r2.writes.voiceover?.clips.map((c) => c.duration_s)).toEqual([4, 4]);
    expect(r2.writes.voiceover?.total_duration_s).toBe(8);
  });

  it('budget-gates only the UNCACHED sections: a fully cached rerun passes a nearly spent cap', async () => {
    let calls = 0;
    const fake: VoiceProvider = {
      name: 'fake', live: true, // live → the gate applies
      async synthesize(text) {
        calls++;
        return { uri: `https://fake.test/voice/gate/${encodeURIComponent(text)}.mp3`, durationS: 3, costUsd: 0.4, license: 'mock' };
      },
    };
    __setVoice(fake);
    const s = stateWith(['gated cacheable narration alpha', 'gated cacheable narration beta'], 'vo-gate');
    const r1 = await voiceover.run(ctxFor(s));
    expect(r1.status).toBe('ok');
    expect(calls).toBe(2);
    // budget nearly exhausted: the OLD all-sections estimate would trip the cap,
    // but everything is cached (cost 0), so the run must proceed.
    s.budget.spent_this_episode_usd = s.budget.cap_usd_month - 0.001;
    const r2 = await voiceover.run(ctxFor(s));
    expect(r2.status).toBe('ok');
    expect(r2.cost_usd).toBe(0);
    expect(calls).toBe(2); // no re-billing
  });

  it('fails the precondition cleanly when there is no script', async () => {
    __setVoice({ name: 'fake', live: false, async synthesize() { throw new Error('must not be called'); } });
    const r = await voiceover.run(ctxFor(newEpisodeState('vo-empty')));
    expect(r.status).toBe('failed');
    expect(r.notes).toContain('precondition');
  });
});
