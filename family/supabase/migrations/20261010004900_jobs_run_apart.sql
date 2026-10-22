-- The daily jobs leave a record of their last run.
--
-- The daily cron runs three jobs apart now (pushes, the nightly backup, the file
-- cleanup of deleted homes): each with its own configuration check and its own
-- failure, so one cannot stop the others. Each job's last run is kept here, one
-- row per job, written by the server (service role) and shown on the Audit
-- screen to audit viewers, so a night that went wrong is seen, not guessed at.

create table if not exists public.job_runs (
  job          text primary key,
  last_at      timestamptz not null,
  last_status  text not null check (last_status in ('ok', 'failed', 'not_configured')),
  last_ms      integer,
  last_error   text,
  last_report  jsonb,
  last_ok_at   timestamptz
);
alter table public.job_runs enable row level security;
revoke all on public.job_runs from public, anon, authenticated;
grant select, insert, update, delete on public.job_runs to service_role;
-- The reader below runs as app_rls; nothing else reads the table.
create policy job_runs_app on public.job_runs for select to app_rls using (true);

-- The last run of every job, for those who may read the audit log.
create or replace function public.job_runs_list() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('audit', 'view') then
    perform private.audit_write('audit', 'view', false, 'job_runs');
    return private.denied();
  end if;
  return jsonb_build_object('ok', true, 'runs', coalesce((
    select jsonb_agg(jsonb_build_object(
      'job', j.job, 'last_at', j.last_at, 'last_status', j.last_status, 'last_ms', j.last_ms,
      'last_error', j.last_error, 'last_report', j.last_report, 'last_ok_at', j.last_ok_at) order by j.job)
    from public.job_runs j), '[]'::jsonb));
end $$;
alter function public.job_runs_list() owner to app_rls;
grant execute on function public.job_runs_list() to authenticated, service_role;
