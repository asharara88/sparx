import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Returns a Supabase client if credentials are present, else null.
// The skeleton runs fine without Supabase (falls back to in-memory store),
// so the foundation is testable before keys are wired in.
export function getSupabase(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}
