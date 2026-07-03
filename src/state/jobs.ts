import type { SupabaseClient } from '@supabase/supabase-js';

// Worker-side render-job queue access. Mirrors web/lib/jobs.ts; both track the
// columns in supabase/migrations/0002_render_jobs.sql.
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
}

// Atomically claim the oldest queued job via the SKIP LOCKED RPC, so multiple
// worker instances never grab the same job. Returns null when the queue is empty.
export async function claimJob(sb: SupabaseClient, workerId: string): Promise<RenderJob | null> {
  const { data, error } = await sb.rpc('claim_render_job', { p_worker: workerId });
  if (error) throw new Error(`claimJob failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  return (row as RenderJob) ?? null;
}

// Requeue jobs abandoned by a worker that died mid-run (deploy/restart).
export async function requeueStaleJobs(sb: SupabaseClient): Promise<number> {
  const { data, error } = await sb.rpc('requeue_stale_jobs');
  if (error) throw new Error(`requeueStaleJobs failed: ${error.message}`);
  return Array.isArray(data) ? data.length : 0;
}

export async function setJobEpisode(sb: SupabaseClient, id: string, episodeId: string): Promise<void> {
  await sb.from('render_jobs').update({ episode_id: episodeId }).eq('id', id);
}

// Replace the job's log window. The worker keeps a bounded tail in memory and
// pushes it periodically, so the row never grows unbounded.
export async function updateJobLog(sb: SupabaseClient, id: string, log: string): Promise<void> {
  await sb.from('render_jobs').update({ log }).eq('id', id);
}

export async function finishJob(
  sb: SupabaseClient,
  id: string,
  patch: { status: 'done' | 'failed'; log: string; video_path?: string | null; episode_id?: string | null; error?: string | null },
): Promise<void> {
  await sb.from('render_jobs').update({ ...patch, finished_at: new Date().toISOString() }).eq('id', id);
}
