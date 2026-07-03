import { NextResponse } from 'next/server';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getSupabase, type EpisodeRow } from '@/lib/supabase';
import { GENERATED_DIR } from '@/lib/paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const hasLocalVideo = (id: string) => existsSync(join(GENERATED_DIR, id, 'cut.mp4'));

// List recent episodes from Supabase. Empty (not an error) when unconfigured.
export async function GET() {
  const sb = getSupabase();
  if (!sb) return NextResponse.json({ configured: false, episodes: [] });

  const { data, error } = await sb
    .from('episodes')
    .select('episode_id,status,niche,host_mode,spent_usd,created_at,updated_at,video_path')
    .order('updated_at', { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ configured: true, episodes: [], error: error.message }, { status: 500 });
  // A cut lives in Storage (deployed, video_path set) or on local disk (dev).
  const episodes = ((data ?? []) as (EpisodeRow & { video_path: string | null })[]).map(({ video_path, ...e }) => ({
    ...e,
    hasVideo: !!video_path || hasLocalVideo(e.episode_id),
  }));
  return NextResponse.json({ configured: true, episodes });
}
