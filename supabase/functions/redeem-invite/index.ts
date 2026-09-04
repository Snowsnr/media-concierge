import { handleOptions, json, safeError } from '../_shared/http.ts';
import { adminClient, authenticatedUser } from '../_shared/supabase.ts';
import { sha256 } from '../_shared/security.ts';

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  if (request.method !== 'POST') return safeError(request, 405, 'Método no permitido.');

  const user = await authenticatedUser(request);
  if (!user) return safeError(request, 401, 'Sesión inválida.');
  const body = await request.json().catch(() => null);
  const token = typeof body?.token === 'string' ? body.token : '';
  const displayName = typeof body?.displayName === 'string' ? body.displayName.trim() : '';
  if (token.length < 32 || displayName.length < 2 || displayName.length > 80) {
    return safeError(request, 400, 'Invitación o nombre inválido.');
  }

  const admin = adminClient();
  const { data: allowed } = await admin.rpc('check_rate_limit', {
    p_subject: user.id,
    p_action: 'redeem-invite',
    p_limit: 8,
    p_window_seconds: 900,
  });
  if (!allowed) return safeError(request, 429, 'Demasiados intentos. Intenta más tarde.');

  const { data, error } = await admin.rpc('redeem_family_invitation', {
    p_token_hash: await sha256(token),
    p_user_id: user.id,
    p_display_name: displayName,
  });
  if (error) return safeError(request, 400, 'La invitación expiró, fue usada o está revocada.');
  return json(request, { profile: data });
});
