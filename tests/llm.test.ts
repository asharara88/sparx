import { describe, it, expect, vi, afterEach } from 'vitest';
import { z } from 'zod';
import { extractJson, __setLLM, getLLM, AnthropicLLM } from '../src/llm/client.js';
import { createLogger } from '../src/logger.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); });

// Capture the request body sent to Anthropic and return a canned response.
function captureFetch(text: string) {
  const bodies: any[] = [];
  globalThis.fetch = vi.fn(async (_url: any, init: any) => {
    bodies.push(JSON.parse(init.body));
    return {
      ok: true, status: 200,
      json: async () => ({ content: [{ text }], stop_reason: 'end_turn', model: 'claude-fable-5', usage: { input_tokens: 10, output_tokens: 20 } }),
      text: async () => text,
    } as any;
  }) as any;
  return bodies;
}

describe('llm client', () => {
  it('extractJson strips code fences and prose', () => {
    expect(extractJson('here:\n```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(JSON.parse(extractJson('blah {"b":2}'))).toEqual({ b: 2 });
  });
  it('mock LLM validates against schema', async () => {
    __setLLM(null);
    const llm = getLLM(); // no API key in tests → MockLLM
    const schema = z.object({ x: z.number() });
    const good = await llm.complete({ system: 's', prompt: 'p', schema, mock: '{"x":5}' });
    expect(good.data).toEqual({ x: 5 });
    expect(good.live).toBe(false);
    await expect(llm.complete({ system: 's', prompt: 'p', schema, mock: '{"x":"no"}' })).rejects.toThrow();
  });

  it('Fable schema calls use low effort; prose uses the configured effort', async () => {
    const llm = new AnthropicLLM('key', createLogger({ mod: 'test' }));
    // pro tier resolves to claude-fable-5 (default), which sends output_config.effort.
    const schemaBodies = captureFetch('{"x":7}');
    await llm.complete({ system: 's', prompt: 'p', tier: 'pro', schema: z.object({ x: z.number() }), mock: '{"x":7}' });
    // JSON call: low effort so Fable's thinking doesn't devour the token budget.
    expect(schemaBodies[0].output_config.effort).toBe('low');

    const proseBodies = captureFetch('just prose, no json');
    await llm.complete({ system: 's', prompt: 'p', tier: 'pro', mock: 'x' });
    expect(proseBodies[0].output_config.effort).toBe('high');
    // Fable must never receive temperature (400s) and opts into the Opus fallback.
    expect(proseBodies[0].temperature).toBeUndefined();
    expect(proseBodies[0].fallbacks).toEqual([{ model: 'claude-opus-4-8' }]);
  });
});
