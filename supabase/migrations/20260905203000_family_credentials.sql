alter table public.family_members
  add column username text;

alter table public.family_members
  add constraint family_members_username_format
  check (username is null or username ~ '^[a-z0-9][a-z0-9._-]{2,31}$');

create unique index family_members_username_unique
  on public.family_members(username)
  where username is not null;

grant select (username) on table public.family_members to authenticated;

create or replace function public.redeem_family_account(
  p_token_hash text,
  p_user_id uuid,
  p_display_name text,
  p_username text
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

  insert into public.family_members(user_id, invitation_id, display_name, username)
  values (p_user_id, invitation.id, trim(p_display_name), p_username)
  returning * into member;

  update public.invitations
  set redeemed_at = now(), redeemed_by = p_user_id
  where id = invitation.id;

  return member;
end;
$$;

revoke all on function public.redeem_family_account(text, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.redeem_family_account(text, uuid, text, text)
  to service_role;
