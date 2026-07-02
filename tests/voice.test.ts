import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { existsSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ElevenLabsVoice } from '../src/media/voice.js';

const realFetch = globalThis.fetch;
const VOICE_ID = 'test_voice_cache';
const CACHE_DIR = join('generated', 'voice');
// generated/voice is the LIVE cache of paid ElevenLabs audio — delete only this
// suite's own artifacts (keyed by the distinctive test voice id), never the dir.
const cleanup = () => {
  if (!existsSync(CACHE_DIR)) return;
  for (const f of readdirSync(CACHE_DIR)) {
    if (f.startsWith(`${VOICE_ID}_`)) rmSync(join(CACHE_DIR, f), { force: true });
  }
};

beforeEach(cleanup);
afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); cleanup(); });

function mockTts() {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => new TextEncoder().encode('mp3-bytes').buffer,
    text: async () => '',
  })) as unknown as typeof fetch;
}

describe('ElevenLabsVoice cache', () => {
  it('bills the API once, then serves identical text from the on-disk cache at $0', async () => {
    globalThis.fetch = mockTts();
    const v = new ElevenLabsVoice('key');
    const first = await v.synthesize('hello world from the cache test', VOICE_ID);
    expect(first.meta?.cached).toBeUndefined();
    const second = await v.synthesize('hello world from the cache test', VOICE_ID);
    expect(second.uri).toBe(first.uri);
    expect(second.costUsd).toBe(0);
    expect(second.meta?.cached).toBe(true);
    expect((globalThis.fetch as any).mock.calls.length).toBe(1);
  });

  it('dedupes concurrent requests for the same text (voiceover + avatar agents)', async () => {
    globalThis.fetch = mockTts();
    const v = new ElevenLabsVoice('key');
    // Long enough that one synthesis has a nonzero rounded cost.
    const text = 'same section narration '.repeat(100);
    const [a, b] = await Promise.all([
      v.synthesize(text, VOICE_ID),
      v.synthesize(text, VOICE_ID),
    ]);
    expect(a.uri).toBe(b.uri);
    expect((globalThis.fetch as any).mock.calls.length).toBe(1);
    // Only the initiating caller records the API charge; the joiner reports $0,
    // so the one ElevenLabs bill is never double-counted in the episode ledger.
    expect(Math.min(a.costUsd, b.costUsd)).toBe(0);
    expect(Math.max(a.costUsd, b.costUsd)).toBeGreaterThan(0);
  });

  it('different text still hits the API separately', async () => {
    globalThis.fetch = mockTts();
    const v = new ElevenLabsVoice('key');
    await v.synthesize('first text', VOICE_ID);
    await v.synthesize('second text', VOICE_ID);
    expect((globalThis.fetch as any).mock.calls.length).toBe(2);
  });

  it('re-fetches when the cached file is a truncated zero-byte artifact', async () => {
    globalThis.fetch = mockTts();
    const v = new ElevenLabsVoice('key');
    const first = await v.synthesize('zero byte cache guard', VOICE_ID);
    writeFileSync(first.uri, ''); // simulate a writer killed mid-cache
    const second = await v.synthesize('zero byte cache guard', VOICE_ID);
    expect((globalThis.fetch as any).mock.calls.length).toBe(2);
    expect(second.meta?.cached).toBeUndefined();
    expect(statSync(second.uri).size).toBeGreaterThan(0);
  });
});
