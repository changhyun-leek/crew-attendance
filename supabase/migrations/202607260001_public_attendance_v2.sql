begin;

create extension if not exists pgcrypto;

do $$ begin
  create type public.app_role as enum ('teacher', 'executive');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.membership_status as enum ('active', 'long_absence', 'left');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.attendance_status as enum ('unchecked', 'present', 'absent');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.actor_type as enum ('teacher', 'executive', 'assistant', 'legacy_import');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  display_name text not null check (char_length(trim(display_name)) between 2 and 30),
  role public.app_role not null default 'teacher',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.teacher_credentials (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  auth_email text not null unique,
  failed_count integer not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.crews (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  operating_year integer not null default extract(year from current_date)::integer,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  ended_at date,
  unique(name, operating_year)
);

create table if not exists public.crew_assignments (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references public.crews(id) on delete restrict,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  starts_on date not null default current_date,
  ends_on date,
  is_primary boolean not null default true,
  created_at timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on)
);
create unique index if not exists one_active_primary_per_crew on public.crew_assignments(crew_id) where is_primary and ends_on is null;
create unique index if not exists one_active_crew_per_teacher on public.crew_assignments(profile_id) where is_primary and ends_on is null;

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (char_length(trim(display_name)) between 1 and 30),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crew_memberships (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete restrict,
  crew_id uuid not null references public.crews(id) on delete restrict,
  status public.membership_status not null default 'active',
  joined_on date not null default current_date,
  status_changed_on date not null default current_date,
  ended_on date,
  status_note text,
  sort_order integer not null default 0,
  legacy_member_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists memberships_crew_status_idx on public.crew_memberships(crew_id, status, sort_order);
create unique index if not exists memberships_legacy_idx on public.crew_memberships(legacy_member_id) where legacy_member_id is not null;

create table if not exists public.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references public.crews(id) on delete restrict,
  attendance_date date not null,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(crew_id, attendance_date)
);

create table if not exists public.assistant_sessions (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references public.crews(id) on delete restrict,
  attendance_session_id uuid not null references public.attendance_sessions(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 2 and 30),
  token_hash text not null unique,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  corrected_at timestamptz,
  active boolean not null default true
);
create index if not exists assistant_token_idx on public.assistant_sessions(token_hash, expires_at);

create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.attendance_sessions(id) on delete cascade,
  membership_id uuid not null references public.crew_memberships(id) on delete restrict,
  status public.attendance_status not null default 'unchecked',
  actor_type public.actor_type,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  assistant_session_id uuid references public.assistant_sessions(id) on delete set null,
  marked_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(session_id, membership_id)
);
create index if not exists attendance_records_session_idx on public.attendance_records(session_id, status);

create table if not exists public.attendance_events (
  id bigint generated always as identity primary key,
  session_id uuid references public.attendance_sessions(id) on delete set null,
  record_id uuid references public.attendance_records(id) on delete set null,
  membership_id uuid references public.crew_memberships(id) on delete set null,
  event_type text not null,
  old_status public.attendance_status,
  new_status public.attendance_status,
  actor_type public.actor_type not null,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  assistant_session_id uuid references public.assistant_sessions(id) on delete set null,
  actor_name_snapshot text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists attendance_events_session_idx on public.attendance_events(session_id, created_at desc);

create or replace function public.is_executive()
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.profiles where auth_user_id = auth.uid() and active and role = 'executive') $$;

create or replace function public.can_access_crew(target_crew uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.is_executive() or exists(
    select 1 from public.crew_assignments a
    join public.profiles p on p.id = a.profile_id
    where p.auth_user_id = auth.uid() and p.active and a.crew_id = target_crew
      and a.starts_on <= current_date and (a.ends_on is null or a.ends_on >= current_date)
  )
$$;

create or replace function public.ensure_attendance_session(target_crew uuid, target_date date)
returns uuid language plpgsql security definer set search_path = public
as $$
declare result_id uuid;
begin
  insert into public.attendance_sessions(crew_id, attendance_date)
  values(target_crew, target_date)
  on conflict(crew_id, attendance_date) do update set crew_id = excluded.crew_id
  returning id into result_id;

  insert into public.attendance_records(session_id, membership_id, status)
  select result_id, m.id, 'unchecked'
  from public.crew_memberships m
  where m.crew_id = target_crew and m.status = 'active'
    and m.joined_on <= target_date and (m.ended_on is null or m.ended_on >= target_date)
  on conflict(session_id, membership_id) do nothing;
  return result_id;
end $$;

alter table public.profiles enable row level security;
alter table public.teacher_credentials enable row level security;
alter table public.crews enable row level security;
alter table public.crew_assignments enable row level security;
alter table public.students enable row level security;
alter table public.crew_memberships enable row level security;
alter table public.attendance_sessions enable row level security;
alter table public.attendance_records enable row level security;
alter table public.assistant_sessions enable row level security;
alter table public.attendance_events enable row level security;

drop policy if exists profiles_self_or_executive on public.profiles;
create policy profiles_self_or_executive on public.profiles for select to authenticated
using (auth_user_id = auth.uid() or public.is_executive());
drop policy if exists crews_assigned_or_executive on public.crews;
create policy crews_assigned_or_executive on public.crews for select to authenticated
using (public.can_access_crew(id));
drop policy if exists assignments_assigned_or_executive on public.crew_assignments;
create policy assignments_assigned_or_executive on public.crew_assignments for select to authenticated
using (public.can_access_crew(crew_id));
drop policy if exists memberships_assigned_or_executive on public.crew_memberships;
create policy memberships_assigned_or_executive on public.crew_memberships for select to authenticated
using (public.can_access_crew(crew_id));
drop policy if exists students_assigned_or_executive on public.students;
create policy students_assigned_or_executive on public.students for select to authenticated
using (public.is_executive() or exists(select 1 from public.crew_memberships m where m.student_id = id and public.can_access_crew(m.crew_id)));
drop policy if exists sessions_assigned_or_executive on public.attendance_sessions;
create policy sessions_assigned_or_executive on public.attendance_sessions for select to authenticated
using (public.can_access_crew(crew_id));
drop policy if exists records_assigned_or_executive on public.attendance_records;
create policy records_assigned_or_executive on public.attendance_records for select to authenticated
using (exists(select 1 from public.attendance_sessions s where s.id = session_id and public.can_access_crew(s.crew_id)));
drop policy if exists events_assigned_or_executive on public.attendance_events;
create policy events_assigned_or_executive on public.attendance_events for select to authenticated
using (exists(select 1 from public.attendance_sessions s where s.id = session_id and public.can_access_crew(s.crew_id)));

revoke all on public.teacher_credentials from anon, authenticated;
revoke all on public.assistant_sessions from anon, authenticated;
revoke execute on function public.ensure_attendance_session(uuid, date) from public, anon, authenticated;
grant execute on function public.ensure_attendance_session(uuid, date) to service_role;

-- 기존 v1 데이터를 삭제 없이 새 구조로 복사한다.
do $$
declare
  legacy_crew uuid;
  legacy_date date;
begin
  if to_regclass('public.crew_members') is null or to_regclass('public.attendance') is null then return; end if;

  insert into public.crews(name, operating_year, active)
  values('이창현 크루', extract(year from current_date)::integer, true)
  on conflict(name, operating_year) do update set active = true
  returning id into legacy_crew;

  insert into public.students(display_name)
  select cm.name from public.crew_members cm
  where not exists(select 1 from public.crew_memberships m where m.legacy_member_id = cm.id::text);

  insert into public.crew_memberships(student_id, crew_id, status, joined_on, sort_order, legacy_member_id)
  select s.id, legacy_crew, 'active', current_date, cm.sort_order, cm.id::text
  from public.crew_members cm
  join lateral (
    select id from public.students where display_name = cm.name order by created_at desc limit 1
  ) s on true
  where not exists(select 1 from public.crew_memberships m where m.legacy_member_id = cm.id::text);

  for legacy_date in select distinct a.date::date from public.attendance a loop
    insert into public.attendance_sessions(crew_id, attendance_date)
    values(legacy_crew, legacy_date) on conflict do nothing;
  end loop;

  insert into public.attendance_records(session_id, membership_id, status, actor_type, marked_at, updated_at)
  select ses.id, m.id,
    case when a.status = 'present' then 'present'::public.attendance_status else 'absent'::public.attendance_status end,
    'legacy_import', ses.created_at, ses.created_at
  from public.attendance a
  join public.attendance_sessions ses on ses.crew_id = legacy_crew and ses.attendance_date = a.date::date
  join public.crew_memberships m on m.legacy_member_id = a.member_id::text
  on conflict(session_id, membership_id) do nothing;

  insert into public.attendance_events(session_id, record_id, membership_id, event_type, new_status, actor_type, actor_name_snapshot)
  select r.session_id, r.id, r.membership_id, 'legacy_import', r.status, 'legacy_import', '기존 시스템 이관'
  from public.attendance_records r
  join public.attendance_sessions s on s.id = r.session_id and s.crew_id = legacy_crew
  where r.actor_type = 'legacy_import'
    and not exists(select 1 from public.attendance_events e where e.record_id = r.id and e.event_type = 'legacy_import');
end $$;

commit;
