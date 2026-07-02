import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the artifact cache + channel memory BEFORE any config-reading import
// (config caches process.env on first read). Static imports hoist, so everything
// that touches config is imported dynamically after the env is set.
const tmp = mkdtempSync(join(tmpdir(), 'sparx-packaging-'));
process.env.CACHE_DIR = join(tmp, 'cache');
process.env.CHANNEL_MEMORY_PATH = join(tmp, 'memory.json');
process.env.ARTIFACT_CACHE = 'true';

const { packaging } = await import('../src/agents/packaging.js');
const { __setImage } = await import('../src/media/image.js');
const { __setLLM } = await import('../src/llm/client.js');
const { __resetArtifactCache } = await import('../src/skills/artifactCache.js');
const { saveChannelMemory } = await import('../src/skills/channelMemory.js');
const { newEpisodeState } = await import('../src/types/episode.js');
const { ctxFor } = await import('./helpers.js');

beforeEach(() => {
  __setLLM(null);
  __setImage(null);
  saveChannelMemory({ episodes: [] });
  // fresh artifact cache per test (the cache test exercises persistence within a
  // test) — the manifest lives in memory now, so drop that too, not just the file
  rmSync(join(process.env.CACHE_DIR!, 'artifacts.json'), { force: true });
  __resetArtifactCache();
});

function base(topic = 'sleep science') {
  const s = newEpisodeState(`pkg_${topic.replace(/\W+/g, '_')}`);
  s.concept.topic = topic;
  s.concept.working_title = `Fix your ${topic}`;
  s.concept.angle = `why common ${topic} advice backfires`;
  s.concept.audience = 'busy people';
  s.concept.keywords = ['sleep', 'naps', 'energy'];
  s.script.hook = 'You have been doing this wrong.';
  s.script.hook_variants = ['Everyone gets this wrong — here is proof', 'I tested the popular advice for 30 days'];
  return s;
}

// Image provider that records prompts and the peak number of in-flight renders.
function recordingImage(costUsd = 0.08, delayMs = 25) {
  const stats = { calls: [] as string[], peak: 0 };
  let inflight = 0;
  const provider = {
    name: 'rec', live: true,
    async generate(req: { prompt: string }) {
      const n = stats.calls.push(req.prompt); // index captured at call time, not resolve time
      inflight++; stats.peak = Math.max(stats.peak, inflight);
      await new Promise((r) => setTimeout(r, delayMs));
      inflight--;
      // https:// URIs count as durable for the artifact cache
      return { uri: `https://cdn.test/thumb_${n}.png`, costUsd, meta: {} };
    },
  };
  return { provider, stats };
}

// LLM stub that records prompts and answers with the agent's own mock payload.
function recordingLLM() {
  const prompts: string[] = [];
  const llm = {
    live: false,
    totalUsage: () => ({ inputTokens: 0, outputTokens: 0, costUsd: 0 }),
    async complete(args: any) {
      prompts.push(args.prompt);
      return { text: args.mock, data: JSON.parse(args.mock), usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, live: false };
    },
  };
  return { llm, prompts };
}

describe('packaging', () => {
  it('renders thumbnails in parallel and reports their actual cost', async () => {
    const { provider, stats } = recordingImage(0.08);
    __setImage(provider as any);
    const r = await packaging.run(ctxFor(base('parallel topic')));
    expect(r.status).toBe('ok');
    expect(stats.calls.length).toBe(2);
    expect(stats.peak).toBe(2); // settleLimit + MEDIA_CONCURRENCY(4) → both in flight together
    expect(r.writes.packaging?.thumbnails).toEqual(['https://cdn.test/thumb_1.png', 'https://cdn.test/thumb_2.png']);
    expect(r.cost_usd).toBeCloseTo(0.16, 5);
  });

  it('serves identical thumbnail prompts from the artifact cache (no re-bill)', async () => {
    const { provider, stats } = recordingImage(0.08);
    __setImage(provider as any);
    const first = await packaging.run(ctxFor(base('cached topic')));
    expect(first.cost_usd).toBeCloseTo(0.16, 5);
    expect(stats.calls.length).toBe(2);

    const second = await packaging.run(ctxFor(base('cached topic')));
    expect(stats.calls.length).toBe(2); // no new provider calls
    expect(second.cost_usd).toBe(0);
    expect(second.writes.packaging?.thumbnails?.length).toBe(2);
    expect(second.notes).toContain('2 cached');
  });

  it('includes the script hook variants among the title candidates', async () => {
    __setImage(recordingImage().provider as any);
    const s = base('hooks topic');
    const r = await packaging.run(ctxFor(s));
    const titles = r.writes.packaging?.titles ?? [];
    expect(titles).toContain('Everyone gets this wrong — here is proof');
    expect(titles).toContain('I tested the popular advice for 30 days');
    expect(titles.length).toBeGreaterThanOrEqual(5); // 3 LLM titles + 2 hook variants
  });

  it('skips image spends when the budget is exhausted (falls back to text concepts)', async () => {
    const { provider, stats } = recordingImage(0.08);
    __setImage(provider as any);
    const s = base('broke topic');
    s.budget.spent_this_episode_usd = s.budget.cap_usd_month; // shouldThrottle → true
    const r = await packaging.run(ctxFor(s));
    expect(stats.calls.length).toBe(0);
    expect(r.cost_usd).toBe(0);
    // fallback stores the prose concepts, not render URIs
    expect(r.writes.packaging?.thumbnails?.every((t: string) => !t.startsWith('https://'))).toBe(true);
  });

  it('feeds recent channel-memory titles into the prompt as patterns to avoid', async () => {
    saveChannelMemory({
      episodes: [{
        episode_id: 'old1', topic: 'old topic', title: 'The sleep mistake costing you',
        angle: 'a', keywords: [], published_at: '2026-01-01', youtube_video_id: 'y1',
      }],
    });
    const { llm, prompts } = recordingLLM();
    __setLLM(llm as any);
    __setImage(recordingImage().provider as any);
    const r = await packaging.run(ctxFor(base('memory topic')));
    expect(r.status).toBe('ok');
    expect(prompts[0]).toContain('Avoid repeating these recent title patterns');
    expect(prompts[0]).toContain('The sleep mistake costing you');
  });
});
