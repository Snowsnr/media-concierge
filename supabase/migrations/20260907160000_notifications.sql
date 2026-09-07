do $$ begin
  create type public.notification_audience as enum ('family', 'admin');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.notification_kind as enum (
    'NEW_REQUEST', 'APPROVED', 'NEEDS_INFO', 'READY', 'REJECTED', 'FAILED', 'TEST'
  );
exception when duplicate_object then null;
end $$;

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  audience public.notification_audience not null,
  user_id uuid references public.family_members(user_id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) between 20 and 2048 and endpoint ~ '^https://'),
  p256dh text not null check (char_length(p256dh) between 40 and 256),
  auth_secret text not null check (char_length(auth_secret) between 16 and 128),
  user_agent text not null default '' check (char_length(user_agent) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_subscription_owner check (
    (audience = 'family' and user_id is not null)
    or (audience = 'admin' and user_id is null)
  )
);

create table public.notification_events (
  id uuid primary key default gen_random_uuid(),
  audience public.notification_audience not null,
  recipient_user_id uuid references public.family_members(user_id) on delete cascade,
  request_id uuid references public.public_requests(id) on delete cascade,
  kind public.notification_kind not null,
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 300),
  target_url text not null default '/' check (target_url ~ '^/'),
  dedupe_key text not null unique check (char_length(dedupe_key) between 8 and 240),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notification_event_recipient check (
    (audience = 'family' and recipient_user_id is not null)
    or (audience = 'admin' and recipient_user_id is null)
  )
);

create table public.push_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notification_events(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  attempts integer not null default 0 check (attempts between 0 and 5),
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  delivered_at timestamptz,
  abandoned_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 300),
  created_at timestamptz not null default now(),
  unique (notification_id, subscription_id)
);

create index push_subscriptions_family on public.push_subscriptions(user_id)
  where audience = 'family';
create index notification_events_family on public.notification_events(recipient_user_id, created_at desc)
  where audience = 'family';
create index notification_events_admin on public.notification_events(created_at desc)
  where audience = 'admin';
create index push_deliveries_pending on public.push_deliveries(next_attempt_at, created_at)
  where delivered_at is null and abandoned_at is null;

alter table public.push_subscriptions enable row level security;
alter table public.notification_events enable row level security;
alter table public.push_deliveries enable row level security;

create policy "members read own notifications"
  on public.notification_events for select
  to authenticated
  using (
    audience = 'family'
    and recipient_user_id = auth.uid()
    and exists (
      select 1 from public.family_members member
      where member.user_id = auth.uid() and member.revoked_at is null
    )
  );

create policy "members mark own notifications read"
  on public.notification_events for update
  to authenticated
  using (
    audience = 'family'
    and recipient_user_id = auth.uid()
    and exists (
      select 1 from public.family_members member
      where member.user_id = auth.uid() and member.revoked_at is null
    )
  )
  with check (audience = 'family' and recipient_user_id = auth.uid());

revoke all on public.push_subscriptions from public, anon, authenticated;
revoke all on public.notification_events from public, anon, authenticated;
revoke all on public.push_deliveries from public, anon, authenticated;

grant select (
  id, request_id, kind, title, body, target_url, read_at, created_at
) on public.notification_events to authenticated;
grant update (read_at) on public.notification_events to authenticated;

grant select, insert, update, delete on public.push_subscriptions to service_role;
grant select, insert, update, delete on public.notification_events to service_role;
grant select, insert, update, delete on public.push_deliveries to service_role;
