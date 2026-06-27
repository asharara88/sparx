import type { Script } from '../types/episode.js';
// concept + brand_voice -> script. Used by Scriptwriter (2).
export async function longformWriting(input: { topic: string; angle: string; brandVoice?: string }): Promise<Partial<Script>> {
  return { hook: `Hook about ${input.topic}`, sections: [], cta: '', brand_voice_pass: true, word_count: 0 };
}
