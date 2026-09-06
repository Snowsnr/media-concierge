import { loginEmail, normalizeUsername, validPassword, validUsername } from '../_shared/account.ts';
import { handleOptions, json, safeError } from '../_shared/http.ts';
import { activeFamilyMember, adminClient, authenticatedUser } from '../_shared/supabase.ts';
import { sha256 } from '../_shared/security.ts';

const profile = (member: Record<string, unknown>) => ({
  displayName: String(member.display_name),
  username: String(member.username),
});

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  if (request.method !== 'POST') return safeError(request, 405, 'Método no permitido.');

  const body = await request.json().catch(() => null);
  const action = body?.action;
  const username = normalizeUsername(typeof body?.username === 'string' ? body.username : '');
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!validUsername(username) || !validPassword(password)) {
    return safeError(
      request,
      400,
      'Usa de 3 a 32 letras, números, puntos, guiones o guiones bajos y una contraseña de al menos 10 caracteres.',
    );
  }

  const admin = adminClient();
  if (action === 'register') {
    const token = typeof body?.token === 'string' ? body.token : '';
    const displayName = typeof body?.displayName === 'string' ? body.displayName.trim() : '';
    if (token.length < 32 || displayName.length < 2 || displayName.length > 80) {
      return safeError(request, 400, 'Invitación o nombre inválido.');
    }

    const tokenHash = await sha256(token);
    const { data: allowed, error: rateLimitError } = await admin.rpc('check_rate_limit', {
      p_subject: `account:${tokenHash}`,
      p_action: 'register-account',
      p_limit: 8,
      p_window_seconds: 900,
    });
    if (rateLimitError) return safeError(request, 500, 'No pudimos validar el registro.');
    if (!allowed) return safeError(request, 429, 'Demasiados intentos. Intenta más tarde.');

    const { data: invitation } = await admin
      .from('invitations')
      .select('id')
      .eq('token_hash', tokenHash)
      .is('revoked_at', null)
      .is('redeemed_at', null)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (!invitation) return safeError(request, 400, 'La invitación ya no está disponible.');

    const { data: existing } = await admin
      .from('family_members')
      .select('user_id')
      .eq('username', username)
      .maybeSingle();
    if (existing) return safeError(request, 409, 'Ese nombre de usuario no está disponible.');

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: loginEmail(username),
      password,
      email_confirm: true,
      app_metadata: { family_username: username },
      user_metadata: { display_name: displayName },
    });
    if (createError || !created.user) {
      return safeError(request, 409, 'Ese nombre de usuario no está disponible.');
    }

    const { data: member, error: redeemError } = await admin.rpc('redeem_family_account', {
      p_token_hash: tokenHash,
      p_user_id: created.user.id,
      p_display_name: displayName,
      p_username: username,
    });
    if (redeemError) {
      await admin.auth.admin.deleteUser(created.user.id);
      return safeError(request, 400, 'La invitación ya no está disponible.');
    }
    return json(request, { profile: profile(member) }, 201);
  }

  if (action === 'upgrade') {
    const user = await authenticatedUser(request);
    const member = await activeFamilyMember(request);
    if (!user || !member) return safeError(request, 401, 'Sesión inválida.');

    const { data: conflict } = await admin
      .from('family_members')
      .select('user_id')
      .eq('username', username)
      .neq('user_id', user.id)
      .maybeSingle();
    if (conflict) return safeError(request, 409, 'Ese nombre de usuario no está disponible.');

    const { error: authError } = await admin.auth.admin.updateUserById(user.id, {
      email: loginEmail(username),
      password,
      email_confirm: true,
      app_metadata: { ...user.app_metadata, family_username: username },
      user_metadata: { ...user.user_metadata, display_name: member.display_name },
    });
    if (authError) return safeError(request, 409, 'Ese nombre de usuario no está disponible.');

    const { data: updated, error: memberError } = await admin
      .from('family_members')
      .update({ username })
      .eq('user_id', user.id)
      .select('display_name, username')
      .single();
    if (memberError) return safeError(request, 500, 'No pudimos terminar la actualización.');
    return json(request, { profile: profile(updated) });
  }

  return safeError(request, 400, 'Acción inválida.');
});
