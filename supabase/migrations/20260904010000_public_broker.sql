create extension if not exists pgcrypto;

do $$ begin
  create type public.media_type as enum ('movie', 'series');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.public_request_status as enum (
    'PENDING', 'NEEDS_INFO', 'APPROVED', 'PREPARING', 'READY', 'REJECTED', 'FAILED'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(label) between 1 and 80),
  token_hash text not null unique check (char_length(token_hash) = 64),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  redeemed_at timestamptz,
  redeemed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint invitations_valid_expiry check (expires_at > created_at)
);

create table if not exists public.family_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  invitation_id uuid not null unique references public.invitations(id),
  display_name text not null check (char_length(display_name) between 2 and 80),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.public_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.family_members(user_id),
  idempotency_key uuid not null,
  tmdb_id integer not null check (tmdb_id > 0),
  media_type public.media_type not null,
  localized_title text not null check (char_length(localized_title) between 1 and 200),
  original_title text not null check (char_length(original_title) between 1 and 200),
  release_year integer not null check (release_year between 1888 and 2200),
  overview text not null default '' check (char_length(overview) <= 2000),
  poster_url text not null check (poster_url ~ '^https://image\.tmdb\.org/'),
  note text check (note is null or char_length(note) <= 500),
  scope jsonb,
  public_status public.public_request_status not null default 'PENDING',
  public_episodes jsonb not null default '[]'::jsonb,
  bridge_claimed_at timestamptz,
  bridge_synced_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (requester_id, idempotency_key),
  constraint request_scope_matches_type check (
    (media_type = 'movie' and scope is null)
    or
    (media_type = 'series' and jsonb_typeof(scope) = 'object' and scope ? 'kind')
  )
);

create table if not exists public.public_request_history (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.public_requests(id) on delete cascade,
  public_status public.public_request_status not null,
  note text not null check (char_length(note) between 1 and 500),
  created_at timestamptz not null default now()
);

create table if not exists public.rate_limit_windows (
  subject text not null,
  action text not null,
  window_start timestamptz not null,
  request_count integer not null default 1,
  primary key (subject, action, window_start)
);

create index if not exists public_requests_requester_created
  on public.public_requests(requester_id, created_at desc);
create index if not exists public_requests_bridge_pending
  on public.public_requests(public_status, bridge_synced_at, created_at);
create index if not exists public_history_request_created
  on public.public_request_history(request_id, created_at);
create index if not exists invitations_active_hash
  on public.invitations(token_hash)
  where revoked_at is null and redeemed_at is null;

alter table public.invitations enable row level security;
alter table public.family_members enable row level security;
alter table public.public_requests enable row level security;
alter table public.public_request_history enable row level security;
alter table public.rate_limit_windows enable row level security;

drop policy if exists "members read own profile" on public.family_members;
create policy "members read own profile"
  on public.family_members for select
  to authenticated
  using (user_id = auth.uid() and revoked_at is null);

drop policy if exists "members update own display name" on public.family_members;

drop policy if exists "members read own requests" on public.public_requests;
create policy "members read own requests"
  on public.public_requests for select
  to authenticated
  using (
    requester_id = auth.uid()
    and exists (
      select 1 from public.family_members member
      where member.user_id = auth.uid() and member.revoked_at is null
    )
  );

drop policy if exists "members create own pending requests" on public.public_requests;

drop policy if exists "members read own request history" on public.public_request_history;
create policy "members read own request history"
  on public.public_request_history for select
  to authenticated
  using (
    exists (
      select 1 from public.public_requests request
      where request.id = request_id
    )
  );

create or replace function public.touch_public_request()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  new.version = old.version + 1;
  return new;
end;
$$;

drop trigger if exists touch_public_request on public.public_requests;
create trigger touch_public_request
before update on public.public_requests
for each row execute function public.touch_public_request();

create or replace function public.record_initial_request_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.public_request_history(request_id, public_status, note)
  values (new.id, 'PENDING', 'Solicitud recibida.');
  return new;
end;
$$;

drop trigger if exists record_initial_request_status on public.public_requests;
create trigger record_initial_request_status
after insert on public.public_requests
for each row execute function public.record_initial_request_status();

create or replace function public.redeem_family_invitation(
  p_token_hash text,
  p_user_id uuid,
  p_display_name text
)
returns public.family_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation public.invitations;
  member public.family_members;
begin
  select * into invitation
  from public.invitations
  where token_hash = p_token_hash
  for update;

  if invitation.id is null
    or invitation.revoked_at is not null
    or invitation.redeemed_at is not null
    or invitation.expires_at <= now() then
    raise exception 'INVITATION_INVALID';
  end if;

  insert into public.family_members(user_id, invitation_id, display_name)
  values (p_user_id, invitation.id, trim(p_display_name))
  returning * into member;

  update public.invitations
  set redeemed_at = now(), redeemed_by = p_user_id
  where id = invitation.id;

  return member;
end;
$$;

create or replace function public.check_rate_limit(
  p_subject text,
  p_action text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  bucket timestamptz;
  count_now integer;
begin
  bucket := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );
  insert into public.rate_limit_windows(subject, action, window_start, request_count)
  values (p_subject, p_action, bucket, 1)
  on conflict (subject, action, window_start)
  do update set request_count = public.rate_limit_windows.request_count + 1
  returning request_count into count_now;
  return count_now <= p_limit;
end;
$$;

revoke all on public.invitations from anon, authenticated;
revoke all on public.rate_limit_windows from anon, authenticated;
revoke select on public.family_members from anon, authenticated;
grant select (user_id, display_name, revoked_at) on public.family_members to authenticated;
revoke select on public.public_requests from anon, authenticated;
grant select (
  id,
  tmdb_id,
  media_type,
  localized_title,
  original_title,
  release_year,
  overview,
  poster_url,
  note,
  scope,
  public_status,
  public_episodes,
  created_at,
  updated_at
) on public.public_requests to authenticated;
revoke insert, update, delete on public.family_members from anon, authenticated;
revoke insert, update, delete on public.public_requests from anon, authenticated;
revoke insert, update, delete on public.public_request_history from anon, authenticated;
revoke all on function public.redeem_family_invitation(text, uuid, text) from public, anon, authenticated;
revoke all on function public.check_rate_limit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.redeem_family_invitation(text, uuid, text) to service_role;
grant execute on function public.check_rate_limit(text, text, integer, integer) to service_role;
