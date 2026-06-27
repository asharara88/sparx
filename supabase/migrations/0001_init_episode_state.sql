-- AI YouTube Studio — Episode State schema
-- One row per episode. The JSONB `state` column holds the full Episode State
-- document (see YouTube-Studio-Build-Spec.md §4). Top-level columns mirror the
-- few fields the orchestrator queries/indexes on.

create table if not exists episodes (
  episode_id   text primary key,
  status       text not null default 'draft',
  niche        text,
  host_mode    text not null default 'real_face',
  state        jsonb not null default '{}'::jsonb,
  spent_usd    numeric(10,2) not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists episodes_status_idx on episodes (status);

-- Append-only budget ledger across all episodes (rolls up to the monthly cap).
create table if not exists budget_ledger (
  id          bigint generated always as identity primary key,
  episode_id  text references episodes (episode_id) on delete cascade,
  agent       text not null,
  cost_usd    numeric(10,4) not null,
  note        text,
  created_at  timestamptz not null default now()
);

create index if not exists budget_ledger_episode_idx on budget_ledger (episode_id);
create index if not exists budget_ledger_created_idx  on budget_ledger (created_at);

-- Append-only pipeline event log (mirrors state.history for auditing/queries).
create table if not exists pipeline_events (
  id          bigint generated always as identity primary key,
  episode_id  text references episodes (episode_id) on delete cascade,
  agent       text,
  event       text not null,
  detail      jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists pipeline_events_episode_idx on pipeline_events (episode_id);

-- keep updated_at fresh
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists episodes_set_updated_at on episodes;
create trigger episodes_set_updated_at
  before update on episodes
  for each row execute function set_updated_at();

-- Monthly spend view (current calendar month) for the Cost skill.
create or replace view monthly_spend as
select
  date_trunc('month', created_at) as month,
  sum(cost_usd)                   as spent_usd
from budget_ledger
group by 1;
