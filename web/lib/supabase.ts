import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ensureEnv } from './root-env';

// Server-side Supabase client (service role). Returns null when unconfigured, so
// the dashboard degrades to an empty state instead of crashing.
export function getSupabase(): SupabaseClient | null {
  ensureEnv();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export interface EpisodeRow {
  episode_id: string;
  status: string;
  niche: string | null;
  host_mode: string;
  spent_usd: number;
  created_at: string;
  updated_at: string;
}
