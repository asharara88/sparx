import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { extractJson, __setLLM, getLLM } from '../src/llm/client.js';

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
});
