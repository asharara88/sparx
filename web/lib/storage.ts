import type { SupabaseClient } from '@supabase/supabase-js';

// Rendered cuts live in this private Storage bucket (see 0002_render_jobs.sql).
// The worker uploads; the API mints short-lived signed URLs to serve them.
export const RENDERS_BUCKET = 'renders';

export async function signedVideoUrl(sb: SupabaseClient, path: string, expiresInS = 3600): Promise<string | null> {
  const { data, error } = await sb.storage.from(RENDERS_BUCKET).createSignedUrl(path, expiresInS);
  if (error) return null;
  return data.signedUrl;
}
