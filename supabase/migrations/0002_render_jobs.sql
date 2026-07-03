-- Render job queue — the bridge between the Vercel dashboard (which enqueues) and
-- the always-on Railway worker (which drains). Vercel can't run the minutes-long
-- ffmpeg pipeline, so /api/run inserts a row here and the worker claims it.

create table if not exists render_jobs (
  id           uuid primary key default gen_random_uuid(),
  mode         text not null default 'demo',        -- 'demo' | 'pipeline'
  params       jsonb not null default '{}'::jsonb,   -- topic, sections, demoMode, hostMode, avatarId, voiceId, avatarVoice, runwayTakes, music, autoApprove
  status       text not null default 'queued',       -- 'queued' | 'running' | 'done' | 'failed'
  log          text not null default '',             -- streamed stdout tail (worker truncates to a bounded window)
  episode_id   text,                                 -- 'demo' for demo runs; ep_… once a pipeline run knows its id
  video_path   text,                                 -- storage object path (bucket 'renders') once done
  error        text,
  worker_id    text,
  created_at   timestamptz not null default now(),
  claimed_at   timestamptz,
  finished_at  timestamptz,
  updated_at   timestamptz not null default now()
);

create index if not exists render_jobs_status_idx on render_jobs (status, created_at);

drop trigger if exists render_jobs_set_updated_at on render_jobs;
create trigger render_jobs_set_updated_at
  before update on render_jobs
  for each row execute function set_updated_at();  -- defined in 0001

-- Atomically hand one queued job to a worker. SKIP LOCKED lets several workers
-- poll concurrently without ever claiming the same job. Returns the claimed row
-- (zero rows when the queue is empty).
create or replace function claim_render_job(p_worker text)
returns setof render_jobs as $$
  update render_jobs
     set status = 'running', worker_id = p_worker, claimed_at = now()
   where id = (
     select id from render_jobs
      where status = 'queued'
      order by created_at
      for update skip locked
      limit 1
   )
  returning *;
$$ language sql;

-- Videos are served from Supabase Storage, not the ephemeral Vercel filesystem.
-- The episodes row records where its cut landed so the Library can offer a preview.
alter table episodes add column if not exists video_path text;

-- Reclaim jobs whose worker died mid-run (container restart/deploy). Run on worker
-- startup so a crashed job doesn't wedge the queue as a permanent 'running'.
create or replace function requeue_stale_jobs(p_older_than interval default interval '30 minutes')
returns setof render_jobs as $$
  update render_jobs
     set status = 'queued', worker_id = null, claimed_at = null
   where status = 'running' and claimed_at < now() - p_older_than
  returning *;
$$ language sql;

-- Private Storage bucket for rendered cuts. The worker (service role) uploads and
-- the Vercel API (service role) mints short-lived signed URLs — both bypass RLS,
-- so no per-object policies are needed while the bucket stays private.
insert into storage.buckets (id, name, public)
values ('renders', 'renders', false)
on conflict (id) do nothing;
