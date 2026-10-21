-- Two-way Google Sheets sync support
-- Sheet -> dashboard: Apps Script posts edited rows to the `sheet-sync` Edge Function (service role).
-- Dashboard -> sheet: the same function returns shipment IDs/stages that Apps Script writes into
-- "CT ..." columns of the team's tab, plus a full mirror for the "CT Export (Supabase)" tab.

alter table public.shipments
  add column if not exists sheet_hash text,
  add column if not exists sheet_row integer,
  add column if not exists sheet_synced_at timestamptz;

alter table public.shipment_updates drop constraint if exists shipment_updates_update_type_check;
alter table public.shipment_updates add constraint shipment_updates_update_type_check
  check (update_type in ('created', 'stage_change', 'stage_correction', 'note', 'hold', 'release', 'payment', 'migration', 'field_update', 'sheet_sync'));

create table if not exists public.sheet_sync_runs (
  id bigint generated always as identity primary key,
  department public.department not null,
  trigger_source text not null check (trigger_source in ('sheet_edit', 'manual', 'scheduled', 'menu')),
  triggered_by uuid references public.profiles (id),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  rows_seen integer not null default 0,
  created integer not null default 0,
  updated integer not null default 0,
  unchanged integer not null default 0,
  flagged integer not null default 0,
  status text not null default 'running' check (status in ('running', 'ok', 'error')),
  message text
);
create index if not exists sheet_sync_runs_dept_idx on public.sheet_sync_runs (department, started_at desc);

alter table public.sheet_sync_runs enable row level security;
revoke all on public.sheet_sync_runs from anon;
revoke insert, update, delete, truncate on public.sheet_sync_runs from authenticated;
create policy sync_runs_select on public.sheet_sync_runs for select to authenticated
  using (private.can_access_department(department));

alter publication supabase_realtime add table public.sheet_sync_runs;

-- Server-only configuration (shared secret, Apps Script web-app URLs). Not reachable by app users.
create table if not exists private.sync_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
revoke all on private.sync_config from public, anon, authenticated;

create or replace function public.get_sync_config()
returns table (key text, value text)
language sql stable security definer set search_path = ''
as $$ select c.key, c.value from private.sync_config c $$;
revoke all on function public.get_sync_config() from public, anon, authenticated;
grant execute on function public.get_sync_config() to service_role;
