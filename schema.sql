-- 런닝 캘린더 Supabase 스키마
-- Supabase Dashboard > SQL Editor 에서 실행하세요.

create extension if not exists pgcrypto;

-- 러닝화
create table if not exists public.shoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  brand text not null,
  model text not null,
  nickname text,
  color text default '#3b82f6',
  purpose text,
  purchase_date date,
  initial_km numeric default 0,
  max_km numeric default 700,
  retired boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);

-- 훈련 (계획 + 실제 기록 + 메모 + 러닝화)
create table if not exists public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  type text not null default 'easy',
  title text not null,
  planned_distance numeric,
  target_pace text,
  details text,
  status text not null default 'planned' check (status in ('planned', 'done', 'skipped')),
  actual_distance numeric,
  actual_time text,
  avg_hr integer,
  rpe integer check (rpe is null or rpe between 1 and 10),
  memo text,
  shoe_id uuid references public.shoes(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists workouts_user_date_idx on public.workouts (user_id, date);

-- 목표 대회 설정 (사용자당 1행)
create table if not exists public.settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  race_name text,
  race_date date,
  goal_time text,
  updated_at timestamptz not null default now()
);

-- RLS: 본인 데이터만 읽기/쓰기
alter table public.shoes enable row level security;
alter table public.workouts enable row level security;
alter table public.settings enable row level security;

drop policy if exists "own shoes" on public.shoes;
create policy "own shoes" on public.shoes for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own workouts" on public.workouts;
create policy "own workouts" on public.workouts for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own settings" on public.settings;
create policy "own settings" on public.settings for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.shoes, public.workouts, public.settings to authenticated;

-- 목표 대회 (여러 개 등록 가능)
create table if not exists public.races (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  date date not null,
  distance_km numeric not null default 42.195,
  goal_time text,
  priority text not null default 'A' check (priority in ('A', 'B', 'C')),
  location text,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists races_user_date_idx on public.races (user_id, date);
alter table public.races enable row level security;
drop policy if exists "own races" on public.races;
create policy "own races" on public.races for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select, insert, update, delete on public.races to authenticated;

-- 예전 단일 대회 설정(settings)을 races로 이전 (한 번만)
insert into public.races (user_id, name, date, distance_km, goal_time, priority)
select s.user_id, coalesce(s.race_name, '목표 대회'), s.race_date, 42.195, s.goal_time, 'A'
from public.settings s
where s.race_date is not null
  and not exists (select 1 from public.races r where r.user_id = s.user_id and r.date = s.race_date);
-- 러닝 기록 이미지 (가민 공유 이미지 등)
alter table public.workouts add column if not exists images text[] not null default '{}';
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('run-images', 'run-images', false, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
drop policy if exists "run-images read own" on storage.objects;
create policy "run-images read own" on storage.objects for select to authenticated
  using (bucket_id = 'run-images' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "run-images insert own" on storage.objects;
create policy "run-images insert own" on storage.objects for insert to authenticated
  with check (bucket_id = 'run-images' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "run-images update own" on storage.objects;
create policy "run-images update own" on storage.objects for update to authenticated
  using (bucket_id = 'run-images' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "run-images delete own" on storage.objects;
create policy "run-images delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'run-images' and (storage.foldername(name))[1] = auth.uid()::text);

-- v2: 구조화된 훈련, 대회별 계획, 컨디션, 알림, 백업
alter table public.workouts add column if not exists planned_duration text;
alter table public.workouts add column if not exists target_hr text;
alter table public.workouts add column if not exists phase text;
alter table public.workouts add column if not exists race_id uuid references public.races(id) on delete set null;
alter table public.workouts add column if not exists source text;
alter table public.workouts add column if not exists max_hr integer;
alter table public.workouts add column if not exists cadence integer;
create index if not exists workouts_race_idx on public.workouts (race_id);

alter table public.races add column if not exists result_time text;
alter table public.races add column if not exists strategy jsonb not null default '{}'::jsonb;

alter table public.settings add column if not exists birth_year integer;
alter table public.settings add column if not exists max_hr integer;
alter table public.settings add column if not exists resting_hr integer;
alter table public.settings add column if not exists weight numeric;
alter table public.settings add column if not exists notify_enabled boolean not null default false;
alter table public.settings add column if not exists notify_hour integer not null default 6;
alter table public.settings add column if not exists last_backup_at timestamptz;
alter table public.settings add column if not exists last_notified_on date;

create table if not exists public.daily_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  fatigue integer check (fatigue is null or fatigue between 1 and 10),
  sleep_hours numeric,
  sleep_quality integer check (sleep_quality is null or sleep_quality between 1 and 5),
  pain_areas text[] not null default '{}',
  pain_level integer check (pain_level is null or pain_level between 0 and 10),
  weight numeric,
  resting_hr integer,
  note text,
  updated_at timestamptz not null default now(),
  unique (user_id, date)
);
alter table public.daily_logs enable row level security;
drop policy if exists "own daily_logs" on public.daily_logs;
create policy "own daily_logs" on public.daily_logs for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select, insert, update, delete on public.daily_logs to authenticated;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists "own push" on public.push_subscriptions;
create policy "own push" on public.push_subscriptions for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select, insert, update, delete on public.push_subscriptions to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('backups', 'backups', false, 20971520, array['application/json'])
on conflict (id) do nothing;
drop policy if exists "backups own all" on storage.objects;
create policy "backups own all" on storage.objects for all to authenticated
  using (bucket_id = 'backups' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'backups' and (storage.foldername(name))[1] = auth.uid()::text);

-- v3: 가민 활동 ID (중복 방지)
alter table public.workouts add column if not exists garmin_id bigint;
create unique index if not exists workouts_user_garmin_uidx on public.workouts (user_id, garmin_id) where garmin_id is not null;

-- v4: 월간 리포트 공유
alter table public.settings add column if not exists report_prefs jsonb not null default '{}'::jsonb;
create table if not exists public.shared_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  month text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, month)
);
alter table public.shared_reports enable row level security;
drop policy if exists "own shared_reports" on public.shared_reports;
create policy "own shared_reports" on public.shared_reports for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select, insert, update, delete on public.shared_reports to authenticated;
create or replace function public.get_shared_report(rid uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select data || jsonb_build_object('shared_at', updated_at) from public.shared_reports where id = rid
$$;
revoke all on function public.get_shared_report(uuid) from public;
grant execute on function public.get_shared_report(uuid) to anon, authenticated;