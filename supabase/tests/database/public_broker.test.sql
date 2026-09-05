begin;

create extension if not exists pgtap with schema extensions;
select plan(19);

select ok(
  (
    select bool_and(relrowsecurity)
    from pg_class
    where oid in (
      'public.invitations'::regclass,
      'public.family_members'::regclass,
      'public.public_requests'::regclass,
      'public.public_request_history'::regclass,
      'public.rate_limit_windows'::regclass
    )
  ),
  'RLS is enabled on every Phase 2 table'
);

select ok(
  not has_table_privilege('authenticated', 'public.public_requests', 'INSERT'),
  'family sessions cannot insert requests directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.public_requests', 'UPDATE'),
  'family sessions cannot update request state'
);
select ok(
  not has_column_privilege('authenticated', 'public.public_requests', 'bridge_synced_at', 'SELECT'),
  'bridge synchronization fields are hidden'
);
select ok(
  not has_column_privilege('authenticated', 'public.public_requests', 'requester_id', 'SELECT'),
  'internal requester identifiers are hidden from broker reads'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.redeem_family_invitation(text,uuid,text)',
    'EXECUTE'
  ),
  'invitation redemption RPC is service-role only'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.check_rate_limit(text,text,integer,integer)',
    'EXECUTE'
  ),
  'rate-limit RPC is service-role only'
);
select ok(
  has_table_privilege('authenticated', 'public.public_request_history', 'SELECT'),
  'family sessions can read request history through RLS'
);

insert into auth.users (id, aud, role)
values
  ('10000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated'),
  ('10000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated'),
  ('10000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated');

insert into public.invitations (id, label, token_hash, expires_at)
values
  (
    '20000000-0000-4000-8000-000000000001',
    'Familia A',
    repeat('a', 64),
    now() + interval '1 day'
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    'Familia B',
    repeat('b', 64),
    now() + interval '1 day'
  ),
  (
    '20000000-0000-4000-8000-000000000003',
    'Familia C',
    repeat('c', 64),
    now() + interval '1 day'
  );

insert into public.family_members (user_id, invitation_id, display_name)
values
  (
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'Familia A'
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000002',
    'Familia B'
  );

insert into public.public_requests (
  id,
  requester_id,
  idempotency_key,
  tmdb_id,
  media_type,
  localized_title,
  original_title,
  release_year,
  poster_url
)
values
  (
    '30000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    101,
    'movie',
    'Película A',
    'Movie A',
    2024,
    'https://image.tmdb.org/t/p/w500/a.jpg'
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    '40000000-0000-4000-8000-000000000002',
    202,
    'movie',
    'Película B',
    'Movie B',
    2025,
    'https://image.tmdb.org/t/p/w500/b.jpg'
  );

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select is(
  (select count(id)::integer from public.public_requests),
  1,
  'Family A can read its own request'
);
select is(
  (
    select count(id)::integer
    from public.public_requests
    where id = '30000000-0000-4000-8000-000000000002'
  ),
  0,
  'Family A cannot read Family B request'
);
select is(
  (select count(display_name)::integer from public.family_members),
  1,
  'Family A can read only its active profile'
);
select is(
  (select count(id)::integer from public.public_request_history),
  1,
  'Family A can read only its request history'
);

reset role;
update public.family_members
set revoked_at = now()
where user_id = '10000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select is(
  (select count(id)::integer from public.public_requests),
  0,
  'A revoked family member immediately loses request access'
);

reset role;
select lives_ok(
  $$
    select public.redeem_family_invitation(
      repeat('c', 64),
      '10000000-0000-4000-8000-000000000003',
      'Familia C'
    )
  $$,
  'A valid invitation can be redeemed once'
);
select is(
  (
    select count(*)::integer
    from public.invitations
    where id = '20000000-0000-4000-8000-000000000003'
      and redeemed_by = '10000000-0000-4000-8000-000000000003'
      and redeemed_at is not null
  ),
  1,
  'Redemption atomically marks the invitation as used'
);
select throws_ok(
  $$
    select public.redeem_family_invitation(
      repeat('c', 64),
      '10000000-0000-4000-8000-000000000003',
      'Familia C'
    )
  $$,
  'P0001',
  'INVITATION_INVALID',
  'A redeemed invitation cannot be replayed'
);

select is(
  public.check_rate_limit('test-subject', 'test-action', 2, 60),
  true,
  'The first action is allowed by the rate limiter'
);
select is(
  public.check_rate_limit('test-subject', 'test-action', 2, 60),
  true,
  'The second action is allowed by the rate limiter'
);
select is(
  public.check_rate_limit('test-subject', 'test-action', 2, 60),
  false,
  'Actions beyond the configured limit are rejected'
);

select * from finish();
rollback;
