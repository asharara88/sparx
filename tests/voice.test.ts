import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { ElevenLabsVoice } from '../src/media/voice.js';

const realFetch = globalThis.fetch;
const VOICE_ID = 'test_voice_cache';
const cleanup = () => rmSync(join('generated', 'voice'), { recursive: true, force: true });

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
    const [a, b] = await Promise.all([
      v.synthesize('same section narration', VOICE_ID),
      v.synthesize('same section narration', VOICE_ID),
    ]);
    expect(a.uri).toBe(b.uri);
    expect((globalThis.fetch as any).mock.calls.length).toBe(1);
  });

  it('different text still hits the API separately', async () => {
    globalThis.fetch = mockTts();
    const v = new ElevenLabsVoice('key');
    await v.synthesize('first text', VOICE_ID);
    await v.synthesize('second text', VOICE_ID);
    expect((globalThis.fetch as any).mock.calls.length).toBe(2);
  });
});
