import { defineAgent } from './core.js';
import { loadChannelMemory, saveChannelMemory } from '../skills/channelMemory.js';
import { fetchWithRetry } from '../util/http.js';
import { config } from '../config.js';

// Agent — Analytics Feedback. Closes the only loop a production channel actually
// optimizes on: post-publish performance flowing back into the channel memory
// that research (topic dedup, trend context) and packaging (title/CTR patterns)
// read on the NEXT episode. Not part of the episode state machine — run it after
// publish via `npm run analytics -- <episode_id>` (scripts/analytics.ts) or a
// scheduler. Degrades cleanly without YouTube credentials.

interface VideoStats { views: number; avg_view_duration_s: number }

async function fetchStats(videoId: string): Promise<VideoStats | null> {
  const c = config();
  const token = c.YOUTUBE_ACCESS_TOKEN;
  if (!token) return null;
  const url = `https://www.googleapis.com/youtube/v3/videos?part=statistics,contentDetails&id=${encodeURIComponent(videoId)}`;
  const res = await fetchWithRetry(url, { headers: { authorization: `Bearer ${token}` } }, { label: 'youtube.stats' });
  const data = (await res.json()) as { items?: { statistics?: { viewCount?: string } }[] };
  const item = data.items?.[0];
  if (!item) return null;
  return { views: Number(item.statistics?.viewCount ?? 0), avg_view_duration_s: 0 };
}

export const analyticsFeedback = defineAgent({
  name: 'analytics_feedback',
  description: 'Retrieve post-publish performance and write it into cross-episode channel memory for future research/packaging.',
  skills: ['channel-memory'],
  reads: ['concept', 'publish'],
  writes: ['analytics'],

  async execute(ctx) {
    const videoId = ctx.state.publish.youtube_video_id;
    const notes: string[] = [];
    let views = 0, avgView = 0;

    // publish.uploaded is the authoritative signal for a real upload — never
    // sniff the id shape (prefixes are provider trivia, not a contract).
    if (!videoId || !ctx.state.publish.uploaded) {
      notes.push('no real published video id; analytics unavailable');
    } else {
      const stats = await fetchStats(videoId).catch((e) => {
        notes.push(`stats fetch failed: ${String(e).slice(0, 120)}`);
        return null;
      });
      if (stats) { views = stats.views; avgView = stats.avg_view_duration_s; }
      else if (!notes.length) notes.push('no YouTube credentials; analytics unavailable');
    }

    const checked_at = new Date().toISOString();

    // Fold performance into channel memory so the next episode's research/packaging see it.
    const mem = loadChannelMemory();
    const entry = mem.episodes.find((e) => e.episode_id === ctx.episode_id);
    if (entry) {
      entry.performance = { views, impressions_ctr: 0, avg_view_duration_s: avgView, noted_at: checked_at };
      saveChannelMemory(mem);
    } else {
      notes.push('episode not in channel memory (publishing records it on publish)');
    }

    ctx.log.info('analytics recorded', { views, notes: notes.length });
    return {
      writes: { analytics: { checked_at, views, impressions_ctr: 0, avg_view_duration_s: avgView, notes } },
      notes: notes.length ? notes.join('; ') : `views=${views}`,
    };
  },
});
