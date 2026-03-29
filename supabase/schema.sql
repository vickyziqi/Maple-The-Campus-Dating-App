-- ============================================================
-- 暗恋 schema
-- Run this in Supabase SQL editor to set up the database.
-- ============================================================

-- Users table
create table if not exists public.users (
  id           uuid primary key default gen_random_uuid(),
  email        text unique not null,
  name         text not null,
  dept         text not null,
  year         int not null check (year between 1 and 6),
  phone        text not null,
  schedule_text text,
  campus       text,
  created_at   timestamptz default now()
);

-- Swipes table
-- sentiment: 'like' | 'dislike' | 'neutral'
-- UNIQUE prevents duplicate swipes from same user to same target
create table if not exists public.swipes (
  id          uuid primary key default gen_random_uuid(),
  from_user   uuid not null references public.users(id) on delete cascade,
  to_user     uuid not null references public.users(id) on delete cascade,
  sentiment   text not null check (sentiment in ('like', 'dislike', 'neutral')),
  created_at  timestamptz default now(),
  unique (from_user, to_user)
);

-- Matches table
-- user_a is always LEAST(uuid_a, uuid_b) to prevent (A,B) and (B,A) duplicates
create table if not exists public.matches (
  id             uuid primary key default gen_random_uuid(),
  user_a         uuid not null references public.users(id) on delete cascade,
  user_b         uuid not null references public.users(id) on delete cascade,
  status         text not null default 'pending',
  date_card_json jsonb,
  created_at     timestamptz default now(),
  unique (user_a, user_b)
);

-- ============================================================
-- pg trigger: detect mutual 'like' and insert into matches
--
-- Flow:
--   INSERT into swipes (from_user=A, to_user=B, sentiment='like')
--   → trigger checks if (from_user=B, to_user=A, sentiment='like') exists
--   → if yes: INSERT into matches (LEAST(A,B), GREATEST(A,B))
-- ============================================================

create or replace function public.check_mutual_like()
returns trigger
language plpgsql
security definer
as $$
begin
  -- Only care about 'like' swipes
  if NEW.sentiment != 'like' then
    return NEW;
  end if;

  -- Check if the reverse like exists
  if exists (
    select 1 from public.swipes
    where from_user = NEW.to_user
      and to_user   = NEW.from_user
      and sentiment = 'like'
  ) then
    -- Insert match with normalized pair order to prevent duplicates
    -- status='released' immediately so demo doesn't wait for Friday
    insert into public.matches (user_a, user_b, status)
    values (
      least(NEW.from_user, NEW.to_user),
      greatest(NEW.from_user, NEW.to_user),
      'released'
    )
    on conflict do nothing;
  end if;

  return NEW;
end;
$$;

drop trigger if exists on_swipe_insert on public.swipes;
create trigger on_swipe_insert
  after insert on public.swipes
  for each row execute function public.check_mutual_like();

-- ============================================================
-- Row Level Security (keep simple for hackathon)
-- ============================================================

alter table public.users  enable row level security;
alter table public.swipes enable row level security;
alter table public.matches enable row level security;

-- Users: anyone can read (for feed), only owner can update
create policy "users_read_all"   on public.users  for select using (true);
create policy "users_insert_own" on public.users  for insert with check (true);

-- Swipes: users can read/write their own swipes
create policy "swipes_insert" on public.swipes for insert with check (true);
create policy "swipes_read"   on public.swipes for select using (true);

-- Matches: users can read matches they're part of
create policy "matches_read"   on public.matches for select using (true);
create policy "matches_update" on public.matches for update using (true);

-- ============================================================
-- Enable Realtime on matches table
-- (also enable in Supabase dashboard: Database → Replication)
-- ============================================================

alter publication supabase_realtime add table public.matches;

-- ============================================================
-- Seed data — 10 fake profiles for demo feed
-- Replace phone numbers with real ones before demo if needed
-- ============================================================

insert into public.users (name, email, dept, year, phone, campus) values
  ('Alex Chen',   'alex@demo.edu',   'CS',   3, '+8613800000001', '主校区'),
  ('Maria Liu',   'maria@demo.edu',  '经管',  2, '+8613800000002', '主校区'),
  ('James Wang',  'james@demo.edu',  'CS',   2, '+8613800000003', '主校区'),
  ('Sarah Zhang', 'sarah@demo.edu',  '数学',  3, '+8613800000004', '主校区'),
  ('Kevin Li',    'kevin@demo.edu',  '经管',  3, '+8613800000005', '主校区'),
  ('Emma Zhou',   'emma@demo.edu',   '物理',  1, '+8613800000006', '主校区'),
  ('Ryan Xu',     'ryan@demo.edu',   'CS',   4, '+8613800000007', '主校区'),
  ('Lily Huang',  'lily@demo.edu',   '数学',  2, '+8613800000008', '主校区'),
  ('Tom Wu',      'tom@demo.edu',    '物理',  2, '+8613800000009', '主校区'),
  ('Nina Zhao',   'nina@demo.edu',   'CS',   1, '+8613800000010', '主校区')
on conflict do nothing;
