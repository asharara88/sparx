import type { SupabaseClient } from '@supabase/supabase-js';

// Render job queue shared shape. The worker mirrors these in src/state/jobs.ts —
// keep the column names in sync with supabase/migrations/0002_render_jobs.sql.
export type JobMode = 'demo' | 'pipeline';
export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface JobParams {
  topic?: string;
  sections?: number;
  demoMode?: string;
  hostMode?: string;
  avatarId?: string;
  voiceId?: string;
  avatarVoice?: string;
  runwayTakes?: number;
  music?: boolean;
  autoApprove?: boolean;
}

export interface RenderJob {
  id: string;
  mode: JobMode;
  params: JobParams;
  status: JobStatus;
  log: string;
  episode_id: string | null;
  video_path: string | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

// Insert a queued job; the Railway worker claims it. Returns the new job id.
export async function enqueueJob(sb: SupabaseClient, mode: JobMode, params: JobParams): Promise<string> {
  const { data, error } = await sb
    .from('render_jobs')
    .insert({ mode, params, status: 'queued' })
    .select('id')
    .single();
  if (error) throw new Error(`enqueue failed: ${error.message}`);
  return data.id as string;
}

export async function getJob(sb: SupabaseClient, id: string): Promise<RenderJob | null> {
  const { data, error } = await sb
    .from('render_jobs')
    .select('id,mode,params,status,log,episode_id,video_path,error,created_at,finished_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`getJob failed: ${error.message}`);
  return (data as RenderJob) ?? null;
}
