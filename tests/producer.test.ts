import { describe, it, expect, beforeEach } from 'vitest';
import { Producer } from '../src/producer/producer.js';
import { newEpisodeState } from '../src/types/episode.js';
import { __setLLM } from '../src/llm/client.js';

// Stub the slow ffmpeg render here — the real render path is covered by render.test.ts.
// Set before any agent calls config() (config caches on first read).
process.env.RENDER_FAKE = 'true';
beforeEach(() => __setLLM(null)); // ensure MockLLM

describe('producer', () => {
  it('runs end-to-end to published when gates auto-approve', async () => {
    const s = newEpisodeState('ep_test', { niche: 'test niche' });
    const f = await new Producer({ autoApproveGates: true }).run(s);
    expect(f.status).toBe('published');
    expect(f.concept.angle.length).toBeGreaterThan(0);
    expect(f.script.sections.length).toBeGreaterThan(0);
    expect(f.shot_list.length).toBeGreaterThan(0);
    expect(f.publish.youtube_video_id).toBeTruthy();
    expect(f.voiceover.clips.length).toBe(f.script.sections.length);
    expect(f.edit.duration_s).toBeGreaterThan(0);
    expect(f.qa.passed).toBe(true);
    expect(f.packaging.titles.length).toBeGreaterThanOrEqual(3);
    expect(f.publish.chapters.length).toBe(f.script.sections.length);
  });
  it('holds at the first gate when not auto-approving', async () => {
    const s = newEpisodeState('ep_hold', { niche: 'test niche' });
    const f = await new Producer({ autoApproveGates: false }).run(s);
    expect(f.status).toBe('concept_review');
    expect(f.script.sections.length).toBe(0); // never scripted
  });
});
