import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { music } from '../src/agents/music.js';
import { __setMusic, type MusicProvider } from '../src/media/music.js';
import { newEpisodeState } from '../src/types/episode.js';
import { ctxFor } from './helpers.js';

// config() caches on first read; nothing in the import graph reads it at import
// time, so pointing the artifact cache at a fresh temp dir here isolates every run.
process.env.CACHE_DIR = mkdtempSync(join(tmpdir(), 'sparx-music-cache-'));
process.env.ARTIFACT_CACHE = 'true';
delete process.env.ELEVENLABS_API_KEY; // force the zero-key mock provider

afterEach(() => __setMusic(null));

function stateWith(totalS: number, id = 'mu1') {
  const s = newEpisodeState(id);
  s.voiceover.total_duration_s = totalS;
  return s;
}

describe('music', () => {
  it('mock path: license mock, cost 0, bed sized to the voiceover total', async () => {
    const r = await music.run(ctxFor(stateWith(42)));
    expect(r.status).toBe('ok');
    expect(r.writes.music?.license).toBe('mock');
    expect(r.writes.music?.cost_usd).toBe(0);
    expect(r.cost_usd).toBe(0);
    expect(r.writes.music?.track_uri).toContain('42s'); // duration from voiceover.total_duration_s
    expect(r.writes.music?.sfx).toHaveLength(2);
  });

  it('cache hit reuses the track at cost 0 without re-calling the provider', async () => {
    let calls = 0;
    const fake: MusicProvider = {
      name: 'fake', live: false,
      async selectTrack(mood, durationS) {
        calls++;
        return { uri: `https://fake.test/music/${mood}_${durationS}s.mp3`, durationS, costUsd: 0.25, license: 'mock' };
      },
      async sfx(name) { return { uri: `mock://sfx/${name}.wav`, costUsd: 0, license: 'mock' }; },
    };
    __setMusic(fake);
    const s = stateWith(57, 'mu-cache');
    const r1 = await music.run(ctxFor(s));
    expect(r1.cost_usd).toBeCloseTo(0.25);
    expect(calls).toBe(1);
    const r2 = await music.run(ctxFor(s));
    expect(calls).toBe(1); // cache hit — selectTrack never re-called
    expect(r2.cost_usd).toBe(0);
    expect(r2.writes.music?.track_uri).toBe(r1.writes.music?.track_uri);
    expect(r2.writes.music?.license).toBe('mock'); // license honest on hits too
  });

  it('fails the precondition when voiceover produced no duration', async () => {
    const r = await music.run(ctxFor(stateWith(0, 'mu-empty')));
    expect(r.status).toBe('failed');
    expect(r.notes).toContain('precondition');
  });
});
