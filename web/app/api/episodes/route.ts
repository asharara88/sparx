import { NextResponse } from 'next/server';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getSupabase, type EpisodeRow } from '@/lib/supabase';
import { GENERATED_DIR } from '@/lib/paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const hasVideo = (id: string) => existsSync(join(GENERATED_DIR, id, 'cut.mp4'));

// List recent episodes from Supabase. Empty (not an error) when unconfigured.
export async function GET() {
  const sb = getSupabase();
  if (!sb) return NextResponse.json({ configured: false, episodes: [] });

  const { data, error } = await sb
    .from('episodes')
    .select('episode_id,status,niche,host_mode,spent_usd,created_at,updated_at')
    .order('updated_at', { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ configured: true, episodes: [], error: error.message }, { status: 500 });
  const episodes = ((data ?? []) as EpisodeRow[]).map((e) => ({ ...e, hasVideo: hasVideo(e.episode_id) }));
  return NextResponse.json({ configured: true, episodes });
}
