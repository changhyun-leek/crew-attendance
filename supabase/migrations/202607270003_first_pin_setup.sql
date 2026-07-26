begin;

alter table public.teacher_credentials
  add column if not exists pin_initialized boolean not null default true,
  add column if not exists activation_phone_hash text,
  add column if not exists activation_failed_count integer not null default 0,
  add column if not exists activation_locked_until timestamptz,
  add column if not exists activated_at timestamptz;

create table if not exists public.account_security_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete set null,
  event_type text not null check (event_type in ('first_pin_setup_succeeded', 'first_pin_setup_failed', 'pin_changed', 'pin_reset')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists account_security_events_profile_idx
  on public.account_security_events(profile_id, created_at desc);

alter table public.account_security_events enable row level security;
revoke all on public.account_security_events from anon, authenticated;

create table if not exists public.roster_imports (
  source_key text primary key,
  imported_by uuid references public.profiles(id) on delete set null,
  result_counts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.roster_imports enable row level security;
revoke all on public.roster_imports from anon, authenticated;

comment on column public.teacher_credentials.activation_phone_hash is
  'HMAC of profile id and phone last 4 digits. Raw phone data is never stored.';

commit;
