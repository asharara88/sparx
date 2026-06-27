import { describe, it, expect } from 'vitest';
import { videoPrompts, videoPromptFor } from '../src/skills/videoPrompt.js';

describe('videoPrompt skill', () => {
  const spec = { description: 'a creator at a desk', style: 'moody cinematic', camera: 'slow push in', motion: 'low' as const, mood: 'tense', duration_s: 4, negative: ['text'], aspect: '9:16' as const, subjectRef: 'the host' };

  it('produces all three model prompts', () => {
    const p = videoPrompts(spec);
    expect(p.runway).toContain('a creator at a desk');
    expect(p.kling).toContain('a creator at a desk');
    expect(p.veo).toContain('a creator at a desk');
  });
  it('applies negatives across all models', () => {
    const p = videoPrompts(spec);
    for (const v of [p.runway, p.kling, p.veo]) expect(v.toLowerCase()).toContain('avoid: text');
  });
  it('encodes aspect ratio and continuity subject', () => {
    const p = videoPrompts(spec);
    expect(p.runway).toContain('aspect 9:16');
    expect(p.veo.toLowerCase()).toContain('the host');
  });
  it('runway is camera-first', () => {
    expect(videoPromptFor('runway', spec).startsWith('slow push in:')).toBe(true);
  });
});
