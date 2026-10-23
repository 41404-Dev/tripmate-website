-- Run this complete script in Supabase Dashboard > SQL Editor.
-- Every private row is scoped to the signed-in user with Row Level Security.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  email text,
  avatar_url text,
  updated_at timestamptz not null default now()
);

create table if not exists public.trips (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.reviews (
  id text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  data jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.trips enable row level security;
alter table public.reviews enable row level security;

grant usage on schema public to anon, authenticated;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert to authenticated
  with check ((select auth.uid()) = id);
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists "trips_select_own" on public.trips;
create policy "trips_select_own"
  on public.trips for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "trips_insert_own" on public.trips;
create policy "trips_insert_own"
  on public.trips for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "trips_update_own" on public.trips;
create policy "trips_update_own"
  on public.trips for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists "trips_delete_own" on public.trips;
create policy "trips_delete_own"
  on public.trips for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "reviews_read_public" on public.reviews;
create policy "reviews_read_public"
  on public.reviews for select to anon, authenticated
  using (true);
drop policy if exists "reviews_insert_own" on public.reviews;
create policy "reviews_insert_own"
  on public.reviews for insert to authenticated
  with check ((select auth.uid()) = owner_id);
drop policy if exists "reviews_delete_own" on public.reviews;
create policy "reviews_delete_own"
  on public.reviews for delete to authenticated
  using ((select auth.uid()) = owner_id);

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.trips to authenticated;
grant select on public.reviews to anon, authenticated;
grant insert, delete on public.reviews to authenticated;
