import { handleOptions, json, safeError } from '../_shared/http.ts';
import { adminClient } from '../_shared/supabase.ts';
import { bridgeAuthorized, randomToken, sha256 } from '../_shared/security.ts';

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  if (request.method !== 'POST') return safeError(request, 405, 'Método no permitido.');
  if (!(await bridgeAuthorized(request))) return safeError(request, 401, 'No autorizado.');

  const body = await request.json().catch(() => null);
  const action = body?.action;
  const admin = adminClient();
  if (action === 'members') {
    const { data, error } = await admin
      .from('family_members')
      .select('user_id, display_name, username, created_at, revoked_at')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) return safeError(request, 500, 'No se pudieron cargar las cuentas familiares.');
    return json(request, data ?? []);
  }
  if (action === 'reset-password') {
    const userId = typeof body?.userId === 'string' ? body.userId : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    if (!userId || password.length < 10 || password.length > 72) {
      return safeError(request, 400, 'Datos de contraseña inválidos.');
    }
    const { data: member } = await admin
      .from('family_members')
      .select('user_id, username')
      .eq('user_id', userId)
      .is('revoked_at', null)
      .maybeSingle();
    if (!member?.username) return safeError(request, 404, 'La cuenta no está disponible.');
    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) return safeError(request, 500, 'No se pudo restablecer la contraseña.');
    return json(request, { reset: true });
  }
  if (action === 'list') {
    const { data, error } = await admin
      .from('invitations')
      .select('id, label, expires_at, created_at, redeemed_at, revoked_at')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) return safeError(request, 500, 'No se pudieron cargar las invitaciones.');
    return json(request, data ?? []);
  }
  if (action === 'revoke') {
    if (typeof body?.invitationId !== 'string') return safeError(request, 400, 'ID inválido.');
    const { data: invitation, error } = await admin
      .from('invitations')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', body.invitationId)
      .select('id, redeemed_by')
      .single();
    if (error) return safeError(request, 400, 'No se pudo revocar la invitación.');
    if (invitation.redeemed_by) {
      await admin
        .from('family_members')
        .update({ revoked_at: new Date().toISOString() })
        .eq('user_id', invitation.redeemed_by);
    }
    return json(request, { revoked: true });
  }

  const label = typeof body?.label === 'string' ? body.label.trim() : '';
  const expiresInDays = Number(body?.expiresInDays ?? 7);
  if (!label || label.length > 80 || expiresInDays < 1 || expiresInDays > 30) {
    return safeError(request, 400, 'Datos de invitación inválidos.');
  }
  const token = randomToken();
  const { data, error } = await admin
    .from('invitations')
    .insert({
      label,
      token_hash: await sha256(token),
      expires_at: new Date(Date.now() + expiresInDays * 86_400_000).toISOString(),
    })
    .select('id, label, expires_at, created_at, redeemed_at, revoked_at')
    .single();
  if (error) return safeError(request, 500, 'No se pudo crear la invitación.');
  const portal = Deno.env.get('PUBLIC_PORTAL_ORIGIN') ?? 'http://localhost:5173';
  return json(request, { ...data, inviteUrl: `${portal}/#invite=${token}` }, 201);
});
