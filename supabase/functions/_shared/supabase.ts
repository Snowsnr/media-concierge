import { createClient } from 'jsr:@supabase/supabase-js@2';

const url = () => Deno.env.get('SUPABASE_URL')!;

export const adminClient = () =>
  createClient(url(), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

export const authenticatedUser = async (request: Request) => {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  const client = adminClient();
  const { data, error } = await client.auth.getUser(authorization.slice(7));
  return error ? null : data.user;
};

export const activeFamilyMember = async (request: Request) => {
  const user = await authenticatedUser(request);
  if (!user) return null;
  const { data } = await adminClient()
    .from('family_members')
    .select('user_id, display_name, revoked_at')
    .eq('user_id', user.id)
    .is('revoked_at', null)
    .maybeSingle();
  return data ?? null;
};
