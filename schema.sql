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
