import { createClient } from 'jsr:@supabase/supabase-js@2';

const url = () => Deno.env.get('SUPABASE_URL')!;

const adminKey = () => {
  const legacyKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacyKey) return legacyKey;

  const secretKeys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (secretKeys) {
    try {
      const parsed = JSON.parse(secretKeys) as Record<string, unknown>;
      const defaultKey = parsed.default;
      if (typeof defaultKey === 'string' && defaultKey) return defaultKey;

      const firstKey = Object.values(parsed).find(
        (value): value is string => typeof value === 'string' && value.length > 0,
      );
      if (firstKey) return firstKey;
    } catch {
      // Fall through to the explicit error below.
    }
  }

  throw new Error('Supabase admin key is unavailable in the Edge Function environment.');
};

export const adminClient = () =>
  createClient(url(), adminKey(), {
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
    .select('user_id, display_name, username, revoked_at')
    .eq('user_id', user.id)
    .is('revoked_at', null)
    .maybeSingle();
  return data ?? null;
};
