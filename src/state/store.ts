import type { EpisodeState } from '../types/episode.js';
import { normalizeEpisodeState } from '../types/episode.js';
import { getSupabase } from './supabase.js';

// Persistence for the Episode State. Uses Supabase when configured;
// otherwise an in-memory map so the pipeline is runnable in dev/CI.
export interface StateStore {
  save(state: EpisodeState): Promise<void>;
  load(episodeId: string): Promise<EpisodeState | null>;
  logEvent(episodeId: string, agent: string | null, event: string, detail?: unknown): Promise<void>;
  recordCost(episodeId: string, agent: string, costUsd: number, note?: string): Promise<void>;
}

class MemoryStore implements StateStore {
  private map = new Map<string, EpisodeState>();
  async save(s: EpisodeState) { this.map.set(s.episode_id, structuredClone(s)); }
  async load(id: string) { const s = this.map.get(id); return s ? structuredClone(s) : null; }
  async logEvent() { /* no-op in memory */ }
  async recordCost() { /* tracked inside state.budget.ledger */ }
}

class SupabaseStore implements StateStore {
  constructor(private client = getSupabase()!) {}
  async save(s: EpisodeState) {
    const { error } = await this.client.from('episodes').upsert({
      episode_id: s.episode_id,
      status: s.status,
      niche: s.channel.niche || null,
      host_mode: s.channel.host_mode,
      state: s,
      spent_usd: s.budget.spent_this_episode_usd,
    });
    if (error) throw new Error(`Supabase save failed: ${error.message}`);
  }
  async load(id: string) {
    const { data, error } = await this.client.from('episodes').select('state').eq('episode_id', id).maybeSingle();
    if (error) throw new Error(`Supabase load failed: ${error.message}`);
    if (!data?.state) return null;
    // Rows saved by older code lack newer state fields — normalize before agents touch them.
    return normalizeEpisodeState(data.state as Partial<EpisodeState> & { episode_id: string });
  }
  async logEvent(episodeId: string, agent: string | null, event: string, detail?: unknown) {
    await this.client.from('pipeline_events').insert({ episode_id: episodeId, agent, event, detail: detail ?? null });
  }
  async recordCost(episodeId: string, agent: string, costUsd: number, note?: string) {
    await this.client.from('budget_ledger').insert({ episode_id: episodeId, agent, cost_usd: costUsd, note: note ?? null });
  }
}

export function createStore(): StateStore {
  return getSupabase() ? new SupabaseStore() : new MemoryStore();
}
