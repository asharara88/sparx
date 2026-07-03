import { readFileSync } from 'node:fs';
import type { SupabaseClient } from '@supabase/supabase-js';

// Rendered cuts live in this private Storage bucket (see 0002_render_jobs.sql).
export const RENDERS_BUCKET = 'renders';

// Upload a rendered mp4 and return its object path (what we store on the job row
// / episode row). Overwrites so a re-render under the same key replaces the old cut.
export async function uploadRender(sb: SupabaseClient, objectPath: string, filePath: string): Promise<string> {
  const bytes = readFileSync(filePath);
  const { error } = await sb.storage.from(RENDERS_BUCKET).upload(objectPath, bytes, {
    contentType: 'video/mp4',
    upsert: true,
  });
  if (error) throw new Error(`render upload failed: ${error.message}`);
  return objectPath;
}
