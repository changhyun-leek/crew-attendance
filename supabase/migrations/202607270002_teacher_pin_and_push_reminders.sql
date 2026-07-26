begin;

alter table public.teacher_credentials
  add column if not exists pin_changed_at timestamptz;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text not null default '',
  active boolean not null default true,
  last_success_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_subscriptions_profile_idx
  on public.push_subscriptions(profile_id, active);

create table if not exists public.attendance_reminders (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references public.crews(id) on delete restrict,
  attendance_date date not null,
  target_profile_id uuid not null references public.profiles(id) on delete restrict,
  sent_by uuid not null references public.profiles(id) on delete restrict,
  message text not null,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists attendance_reminders_recent_idx
  on public.attendance_reminders(crew_id, attendance_date, created_at desc);

alter table public.push_subscriptions enable row level security;
alter table public.attendance_reminders enable row level security;

revoke all on public.push_subscriptions from anon, authenticated;
revoke all on public.attendance_reminders from anon, authenticated;

commit;
