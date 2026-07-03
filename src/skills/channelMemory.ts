import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { defineSkill } from './registry.js';

// Cross-episode channel memory (Build-Spec §7 'Memory/asset store'). The research
// agent reads it to avoid repeating topics; packaging reads title/CTR patterns;
// the analytics agent writes post-publish performance back. File-backed JSON so
// it works with zero infrastructure; the path is configurable (CHANNEL_MEMORY_PATH).

export interface EpisodeMemory {
  episode_id: string;
  topic: string;
  title: string;
  angle: string;
  keywords: string[];
  published_at: string;      // '' until published
  youtube_video_id: string;  // '' until published
  performance?: {
    views: number;
    impressions_ctr: number;
    avg_view_duration_s: number;
    noted_at: string;
  };
}

export interface ChannelMemory {
  episodes: EpisodeMemory[];
}

const log = createLogger({ mod: 'channel-memory' });

export function loadChannelMemory(): ChannelMemory {
  const p = config().CHANNEL_MEMORY_PATH;
  try {
    if (!existsSync(p)) return { episodes: [] };
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as ChannelMemory;
    return { episodes: Array.isArray(parsed.episodes) ? parsed.episodes : [] };
  } catch (e) {
    log.warn('channel memory unreadable; starting empty', { path: p, err: String(e).slice(0, 120) });
    return { episodes: [] };
  }
}

export function saveChannelMemory(mem: ChannelMemory) {
  const p = config().CHANNEL_MEMORY_PATH;
  try {
    mkdirSync(dirname(p), { recursive: true });
    // tmp+rename: publishing and the analytics script may write concurrently —
    // a reader must never parse a torn file and reset memory to empty.
    const tmp = `${p}.tmp`;
    writeFileSync(tmp, JSON.stringify(mem, null, 2));
    renameSync(tmp, p);
  } catch (e) {
    log.warn('channel memory not persisted', { path: p, err: String(e).slice(0, 120) });
  }
}

/** Upsert an episode's memory entry (keyed by episode_id). */
export function rememberEpisode(entry: EpisodeMemory) {
  const mem = loadChannelMemory();
  const i = mem.episodes.findIndex((e) => e.episode_id === entry.episode_id);
  if (i >= 0) mem.episodes[i] = { ...mem.episodes[i], ...entry };
  else mem.episodes.push(entry);
  saveChannelMemory(mem);
}

/** Topics/titles of past episodes — the research agent's real dedup source. */
export function pastTopics(limit = 20): { topic: string; title: string; keywords: string[] }[] {
  return loadChannelMemory().episodes.slice(-limit).map(({ topic, title, keywords }) => ({ topic, title, keywords }));
}

export const channelMemorySkill = defineSkill<{ limit?: number }, { topic: string; title: string; keywords: string[] }[]>({
  name: 'channel-memory',
  description: 'Cross-episode store: past topics/titles/keywords and post-publish performance, for topic dedup and packaging feedback.',
  run: async ({ limit }) => pastTopics(limit),
});
