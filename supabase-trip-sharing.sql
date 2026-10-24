-- Tripmate: run AFTER supabase-setup.sql. Re-runnable, preserves existing trips.
-- Link recipients must sign in and explicitly accept before reading/editing a trip.
begin;

create table if not exists public.trip_members (
  owner_id uuid not null,
  trip_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  joined_at timestamptz not null default now(),
  primary key(owner_id, trip_id, user_id),
  foreign key(owner_id, trip_id) references public.trips(user_id, id) on delete cascade,
  check (user_id <> owner_id)
);
create index if not exists trip_members_user_idx on public.trip_members(user_id);
create table if not exists public.trip_invites (
  owner_id uuid not null,
  trip_id text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  primary key(owner_id, trip_id),
  foreign key(owner_id, trip_id) references public.trips(user_id, id) on delete cascade
);
alter table public.trip_members enable row level security;
alter table public.trip_invites enable row level security;
revoke all on public.trip_members, public.trip_invites from anon, authenticated;
grant select on public.trip_members to authenticated;
drop policy if exists trip_members_read_self on public.trip_members;
create policy trip_members_read_self on public.trip_members for select to authenticated
using (user_id = (select auth.uid()) or owner_id = (select auth.uid()));
drop policy if exists trips_select_member on public.trips;
create policy trips_select_member on public.trips for select to authenticated using (
  exists (select 1 from public.trip_members m where m.owner_id = trips.user_id
    and m.trip_id = trips.id and m.user_id = (select auth.uid()))
);
-- No direct member UPDATE/DELETE policy: collaborative writes use version-checked RPCs.

create or replace function public.tripmate_my_trips()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'user_id', t.user_id, 'data', t.data,
    'created_at', t.created_at, 'updated_at', t.updated_at,
    'owner_name', coalesce(nullif(t.data->>'ownerDisplayName',''), nullif(p.display_name,''), 'เจ้าของทริป')
  ) order by t.updated_at desc), '[]'::jsonb)
  from public.trips t left join public.profiles p on p.id = t.user_id
  where auth.uid() is not null and (t.user_id = auth.uid() or exists (
    select 1 from public.trip_members m where m.owner_id=t.user_id and m.trip_id=t.id and m.user_id=auth.uid()
  ));
$$;

create or replace function public.tripmate_create_invite(p_trip_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_token text; v_expires timestamptz := now() + interval '7 days';
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  perform 1 from public.trips where user_id=auth.uid() and id=p_trip_id for update;
  if not found then raise exception 'TRIP_FORBIDDEN'; end if;
  -- Two UUIDs provide an unguessable bearer token; only its SHA-256 hash is stored.
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.trip_invites(owner_id,trip_id,token_hash,expires_at)
  values(auth.uid(),p_trip_id,encode(sha256(convert_to(v_token,'UTF8')),'hex'),v_expires)
  on conflict(owner_id,trip_id) do update set token_hash=excluded.token_hash, expires_at=excluded.expires_at;
  return jsonb_build_object('token',v_token,'expires_at',v_expires);
end;
$$;

create or replace function public.tripmate_revoke_invite(p_trip_id text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  perform 1 from public.trips where user_id=auth.uid() and id=p_trip_id for update;
  if not found then raise exception 'TRIP_FORBIDDEN'; end if;
  delete from public.trip_invites where owner_id=auth.uid() and trip_id=p_trip_id;
end;
$$;

create or replace function public.tripmate_invite_preview(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if length(p_token) <> 64 then raise exception 'INVITE_INVALID'; end if;
  select jsonb_build_object('owner_id',t.user_id,'trip_id',t.id,
    'destination',t.data->>'destination','start_date',t.data->>'startDate','end_date',t.data->>'endDate',
    'owner_name',coalesce(nullif(t.data->>'ownerDisplayName',''),nullif(p.display_name,''),'เจ้าของทริป'),
    'expires_at',i.expires_at,
    'joined', t.user_id=auth.uid() or exists(select 1 from public.trip_members m
      where m.owner_id=t.user_id and m.trip_id=t.id and m.user_id=auth.uid())) into v_result
  from public.trip_invites i join public.trips t on t.user_id=i.owner_id and t.id=i.trip_id
  left join public.profiles p on p.id=t.user_id
  where i.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') and i.expires_at>now();
  if v_result is null then raise exception 'INVITE_INVALID'; end if;
  return v_result;
end;
$$;

create or replace function public.tripmate_accept_invite(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_inv public.trip_invites; v_trip public.trips; v_name text; v_owner_name text; v_friends jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if length(p_token) <> 64 then raise exception 'INVITE_INVALID'; end if;
  select * into v_inv from public.trip_invites
    where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') and expires_at>now();
  if not found then raise exception 'INVITE_INVALID'; end if;
  -- All invite/member changes lock the trip first to serialize acceptance and revocation.
  select * into v_trip from public.trips where user_id=v_inv.owner_id and id=v_inv.trip_id for update;
  if not found or not exists(select 1 from public.trip_invites where owner_id=v_inv.owner_id
    and trip_id=v_inv.trip_id and token_hash=v_inv.token_hash and expires_at>now()) then
    raise exception 'INVITE_INVALID';
  end if;
  if auth.uid()=v_trip.user_id or exists(select 1 from public.trip_members
    where owner_id=v_trip.user_id and trip_id=v_trip.id and user_id=auth.uid()) then
    return jsonb_build_object('owner_id',v_trip.user_id,'trip_id',v_trip.id);
  end if;
  select coalesce(nullif(display_name,''),'เพื่อนร่วมทริป') into v_name from public.profiles where id=auth.uid();
  v_name := left(coalesce(v_name,'เพื่อนร่วมทริป'),100);
  select coalesce(nullif(v_trip.data->>'ownerDisplayName',''),nullif(display_name,''),'เจ้าของทริป')
    into v_owner_name from public.profiles where id=v_trip.user_id;
  v_owner_name := coalesce(v_owner_name,'เจ้าของทริป');
  if lower(v_name)=lower(v_owner_name) or exists(select 1 from public.trip_members
    where owner_id=v_trip.user_id and trip_id=v_trip.id and lower(display_name)=lower(v_name)) then
    v_name := v_name || ' (' || left(auth.uid()::text,8) || ')';
  end if;
  insert into public.trip_members(owner_id,trip_id,user_id,display_name)
    values(v_trip.user_id,v_trip.id,auth.uid(),v_name);
  select coalesce(jsonb_agg(f),'[]'::jsonb) into v_friends
    from jsonb_array_elements(case when jsonb_typeof(v_trip.data->'friends')='array' then v_trip.data->'friends' else '[]'::jsonb end) f
    where not ((f->>'userId') is null and lower(trim(coalesce(f->>'name',f#>>'{}','')))=lower(v_name));
  update public.trips set data = data || jsonb_build_object('ownerDisplayName',v_owner_name,'friends',
      v_friends || jsonb_build_array(jsonb_build_object('name',v_name,'going',true,'userId',auth.uid()))),
      updated_at=clock_timestamp() where user_id=v_trip.user_id and id=v_trip.id;
  return jsonb_build_object('owner_id',v_trip.user_id,'trip_id',v_trip.id);
end;
$$;

create or replace function public.tripmate_trip_members(p_owner_id uuid,p_trip_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not exists(select 1 from public.trips t where t.user_id=p_owner_id and t.id=p_trip_id
    and (t.user_id=auth.uid() or exists(select 1 from public.trip_members m
      where m.owner_id=t.user_id and m.trip_id=t.id and m.user_id=auth.uid()))) then raise exception 'TRIP_FORBIDDEN'; end if;
  select jsonb_build_object('members',coalesce((select jsonb_agg(jsonb_build_object(
    'user_id',m.user_id,'name',m.display_name,'joined_at',m.joined_at) order by m.joined_at)
    from public.trip_members m where m.owner_id=p_owner_id and m.trip_id=p_trip_id),'[]'::jsonb),
    'invite_expires_at',case when p_owner_id=auth.uid() then (select expires_at from public.trip_invites
      where owner_id=p_owner_id and trip_id=p_trip_id and expires_at>now()) else null end) into v_result;
  return v_result;
end;
$$;

create or replace function public.tripmate_remove_member(p_trip_id text,p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  perform 1 from public.trips where user_id=auth.uid() and id=p_trip_id for update;
  if not found then raise exception 'TRIP_FORBIDDEN'; end if;
  -- Remove the member from the current participant list. Historical expenses keep
  -- their own paidBy/splitBetween names, so old settlements remain intact.
  update public.trips set data=jsonb_set(data,'{friends}',coalesce((select jsonb_agg(
    f) from jsonb_array_elements(coalesce(data->'friends','[]'::jsonb)) f
    where coalesce(f->>'userId','')<>p_user_id::text),'[]'::jsonb)), updated_at=clock_timestamp()
    where user_id=auth.uid() and id=p_trip_id;
  delete from public.trip_members where owner_id=auth.uid() and trip_id=p_trip_id and user_id=p_user_id;
  -- A removed member cannot rejoin using the old invitation link.
  delete from public.trip_invites where owner_id=auth.uid() and trip_id=p_trip_id;
end;
$$;

create or replace function public.tripmate_update_trip(p_owner_id uuid,p_trip_id text,p_expected_version timestamptz,p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_trip public.trips; v_friends jsonb; v_expenses jsonb := '[]'; v_item jsonb; v_old jsonb; v_name text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_trip from public.trips where user_id=p_owner_id and id=p_trip_id for update;
  if not found or (auth.uid()<>p_owner_id and not exists(select 1 from public.trip_members
    where owner_id=p_owner_id and trip_id=p_trip_id and user_id=auth.uid())) then raise exception 'TRIP_FORBIDDEN'; end if;
  if p_expected_version is null or v_trip.updated_at<>p_expected_version then raise exception 'TRIP_CONFLICT'; end if;
  if jsonb_typeof(p_data)<>'object' or jsonb_typeof(p_data->'expenses') is distinct from 'array'
    or jsonb_typeof(p_data->'friends') is distinct from 'array' then raise exception 'TRIP_INVALID'; end if;
  -- Only the owner can edit/delete expenses entered by someone else.
  if auth.uid()<>p_owner_id then
    for v_old in select value from jsonb_array_elements(coalesce(v_trip.data->'expenses','[]'::jsonb)) loop
      if coalesce(v_old->>'createdBy',p_owner_id::text)<>auth.uid()::text and not exists(
        select 1 from jsonb_array_elements(p_data->'expenses') e where e=v_old) then raise exception 'EXPENSE_FORBIDDEN'; end if;
    end loop;
  end if;
  if exists(select 1 from jsonb_array_elements(p_data->'expenses') e group by e->>'id' having count(*)>1)
    then raise exception 'TRIP_INVALID'; end if;
  for v_item in select value from jsonb_array_elements(p_data->'expenses') loop
    if coalesce(v_item->>'id','')='' then raise exception 'TRIP_INVALID'; end if;
    select value into v_old from jsonb_array_elements(coalesce(v_trip.data->'expenses','[]'::jsonb)) e where e->>'id'=v_item->>'id';
    v_expenses := v_expenses || jsonb_build_array(v_item || jsonb_build_object('createdBy',
      case when v_old is null then auth.uid()::text else coalesce(v_old->>'createdBy',p_owner_id::text) end));
  end loop;
  -- Authenticated membership cannot be added, removed, or forged through the planner JSON.
  select coalesce(jsonb_agg(f-'userId'),'[]'::jsonb) into v_friends from jsonb_array_elements(p_data->'friends') f
    where coalesce(f->>'userId','')='' and not exists(select 1 from public.trip_members m where m.owner_id=p_owner_id
      and m.trip_id=p_trip_id and lower(m.display_name)=lower(coalesce(f->>'name','')));
  select v_friends || coalesce(jsonb_agg(jsonb_build_object('name',m.display_name,'going',true,'userId',m.user_id)
    order by m.joined_at),'[]'::jsonb) into v_friends from public.trip_members m where m.owner_id=p_owner_id and m.trip_id=p_trip_id;
  select coalesce(nullif(v_trip.data->>'ownerDisplayName',''),nullif(display_name,''),'เจ้าของทริป') into v_name
    from public.profiles where id=p_owner_id;
  update public.trips set data = (p_data-'ownerDisplayName') || jsonb_build_object('id',p_trip_id,
    'ownerDisplayName',coalesce(v_name,'เจ้าของทริป'),'friends',v_friends,'expenses',v_expenses), updated_at=clock_timestamp()
    where user_id=p_owner_id and id=p_trip_id returning * into v_trip;
  return jsonb_build_object('id',v_trip.id,'user_id',v_trip.user_id,'data',v_trip.data,
    'updated_at',v_trip.updated_at,'created_at',v_trip.created_at,'owner_name',v_trip.data->>'ownerDisplayName');
end;
$$;

revoke all on function public.tripmate_my_trips() from public, anon;
revoke all on function public.tripmate_create_invite(text) from public, anon;
revoke all on function public.tripmate_revoke_invite(text) from public, anon;
revoke all on function public.tripmate_invite_preview(text) from public, anon;
revoke all on function public.tripmate_accept_invite(text) from public, anon;
revoke all on function public.tripmate_trip_members(uuid,text) from public, anon;
revoke all on function public.tripmate_remove_member(text,uuid) from public, anon;
revoke all on function public.tripmate_update_trip(uuid,text,timestamptz,jsonb) from public, anon;
grant execute on function public.tripmate_my_trips(), public.tripmate_create_invite(text),
 public.tripmate_revoke_invite(text), public.tripmate_invite_preview(text), public.tripmate_accept_invite(text),
 public.tripmate_trip_members(uuid,text), public.tripmate_remove_member(text,uuid),
 public.tripmate_update_trip(uuid,text,timestamptz,jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
