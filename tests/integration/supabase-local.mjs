import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const bridgeToken = 'local-bridge-test-token-256-bits-not-production';
const statusOutput = execFileSync('npx', ['--yes', 'supabase', 'status', '-o', 'env'], {
  cwd: process.cwd(),
  encoding: 'utf8',
});
const local = Object.fromEntries(
  statusOutput
    .split('\n')
    .map((line) => line.match(/^([A-Z_]+)="?(.*?)"?$/))
    .filter(Boolean)
    .map((match) => [match[1], match[2]]),
);

const apiUrl = local.API_URL;
const anonKey = local.ANON_KEY ?? local.PUBLISHABLE_KEY;
const serviceKey = local.SERVICE_ROLE_KEY ?? local.SECRET_KEY;
assert.ok(apiUrl && anonKey && serviceKey, 'Supabase local status did not return API keys');

const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(apiUrl, serviceKey, options);
const familyA = createClient(apiUrl, anonKey, options);
const familyB = createClient(apiUrl, anonKey, options);
const edge = async (name, body, token = bridgeToken) => {
  const response = await fetch(`${apiUrl}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-bridge-token': token },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
};

const checks = [];
const checked = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};
const waitFor = async (task, timeoutMs = 12_000) => {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await task();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw lastError ?? new Error('Timed out waiting for local integration');
};

const unauthorizedBridge = await edge('bridge-sync', { action: 'health' }, 'wrong-token');
checked(unauthorizedBridge.response.status === 401, 'bridge rejects an invalid token');

const bridgeHealth = await edge('bridge-sync', { action: 'health' });
checked(bridgeHealth.response.ok, 'bridge accepts the private local token');

const invitation = await edge('invitations', {
  action: 'create',
  label: 'HTTP Integration Family',
  expiresInDays: 1,
});
checked(invitation.response.status === 201, 'admin Edge Function creates an invitation');
const inviteUrl = new URL(invitation.payload.inviteUrl);
const inviteToken = new URLSearchParams(inviteUrl.hash.slice(1)).get('invite');
assert.ok(inviteToken, 'Invitation response did not contain a fragment token');

const { data: authA, error: authAError } = await familyA.auth.signInAnonymously();
assert.ifError(authAError);
assert.ok(authA.user);
const { error: redeemError } = await familyA.functions.invoke('redeem-invite', {
  body: { token: inviteToken, displayName: 'Ana Integration' },
});
assert.ifError(redeemError);
checks.push('an anonymous session redeems the invitation');

const replay = await familyA.functions.invoke('redeem-invite', {
  body: { token: inviteToken, displayName: 'Ana Integration' },
});
checked(Boolean(replay.error), 'the same invitation cannot be replayed');

const { data: profile, error: profileError } = await familyA
  .from('family_members')
  .select('display_name')
  .single();
assert.ifError(profileError);
checked(profile.display_name === 'Ana Integration', 'RLS exposes the active family profile');

const requestInput = {
  requester_id: authA.user.id,
  idempotency_key: crypto.randomUUID(),
  tmdb_id: 693134,
  media_type: 'movie',
  localized_title: 'Duna: Parte dos',
  original_title: 'Dune: Part Two',
  release_year: 2024,
  overview: 'Local integration fixture.',
  poster_url: 'https://image.tmdb.org/t/p/w500/local-fixture.jpg',
  note: 'Prueba local',
  scope: null,
};
const { error: directInsertError } = await familyA.from('public_requests').insert(requestInput);
checked(Boolean(directInsertError), 'family sessions cannot insert broker rows directly');

const malformed = await familyA.functions.invoke('create-request', {
  body: { tmdbId: -1, mediaType: 'movie', idempotencyKey: crypto.randomUUID() },
});
checked(Boolean(malformed.error), 'create-request rejects malformed input before contacting TMDB');

const { data: inserted, error: insertError } = await admin
  .from('public_requests')
  .insert(requestInput)
  .select('id')
  .single();
assert.ifError(insertError);

const pulled = await edge('bridge-sync', { action: 'pull' });
checked(
  pulled.response.ok &&
    pulled.payload.some(
      (item) => item.publicRequestId === inserted.id && item.requesterName === 'Ana Integration',
    ),
  'bridge pulls the pending request with its family name',
);

const published = await edge('bridge-sync', {
  action: 'update',
  publicRequestId: inserted.id,
  status: 'APPROVED',
  publicEpisodes: [],
  note: 'La solicitud fue aprobada.',
});
checked(published.response.ok, 'bridge publishes a sanitized public status');

const publicColumns = `
  id, localized_title, public_status, public_episodes,
  public_request_history(public_status, note)
`;
const { data: ownRequests, error: ownError } = await familyA
  .from('public_requests')
  .select(publicColumns);
assert.ifError(ownError);
checked(
  ownRequests.length === 1 && ownRequests[0].public_status === 'APPROVED',
  'Family A reads its updated request',
);
checked(
  ownRequests[0].public_request_history.length === 2,
  'family history contains initial and approved public states',
);

const { error: hiddenColumnError } = await familyA
  .from('public_requests')
  .select('bridge_synced_at');
checked(Boolean(hiddenColumnError), 'family sessions cannot select bridge-only columns');

const { error: authBError } = await familyB.auth.signInAnonymously();
assert.ifError(authBError);
const { data: otherRequests, error: otherError } = await familyB
  .from('public_requests')
  .select('id');
assert.ifError(otherError);
checked(otherRequests.length === 0, 'an unrelated family session sees no requests');

const { data: brokerFixture, error: brokerFixtureError } = await admin
  .from('public_requests')
  .insert({
    ...requestInput,
    idempotency_key: crypto.randomUUID(),
    tmdb_id: 603,
    localized_title: 'Matrix',
    original_title: 'The Matrix',
    release_year: 1999,
  })
  .select('id')
  .single();
assert.ifError(brokerFixtureError);

const apiPort = 4110;
const privateApiUrl = `http://127.0.0.1:${apiPort}`;
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'media-concierge-supabase-'));
const apiLogs = [];
const apiProcess = spawn(
  join(process.cwd(), 'node_modules/.bin/tsx'),
  ['services/concierge-api/src/server.ts'],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CONCIERGE_API_PORT: String(apiPort),
      CONCIERGE_DB_PATH: join(temporaryDirectory, 'concierge.db'),
      SUPABASE_URL: apiUrl,
      SUPABASE_BRIDGE_TOKEN: bridgeToken,
      BROKER_POLL_INTERVAL_MS: '60000',
      LOG_LEVEL: 'silent',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
apiProcess.stdout.on('data', (chunk) => apiLogs.push(String(chunk)));
apiProcess.stderr.on('data', (chunk) => apiLogs.push(String(chunk)));

try {
  const apiHealth = await waitFor(async () => {
    const response = await fetch(`${privateApiUrl}/health`);
    return response.ok ? response.json() : null;
  });
  checked(apiHealth.mode === 'supabase-broker', 'private API starts in Supabase broker mode');

  const integrations = await fetch(`${privateApiUrl}/api/integrations/health`).then((response) =>
    response.json(),
  );
  checked(
    integrations.some((item) => item.name === 'Buzón público' && item.status === 'healthy'),
    'private API reports the public broker as healthy',
  );

  const imported = await waitFor(async () => {
    const response = await fetch(`${privateApiUrl}/api/requests`);
    if (!response.ok) return null;
    const requests = await response.json();
    return requests.find((item) => item.publicRequestId === brokerFixture.id) ?? null;
  });
  checked(
    imported.state === 'SYNCED_TO_HOMELAB',
    'private API imports a pending public request into SQLite',
  );

  const { data: syncedFixture, error: syncedFixtureError } = await admin
    .from('public_requests')
    .select('bridge_synced_at')
    .eq('id', brokerFixture.id)
    .single();
  assert.ifError(syncedFixtureError);
  checked(Boolean(syncedFixture.bridge_synced_at), 'private API publishes broker sync completion');

  const proxiedInvitationResponse = await fetch(`${privateApiUrl}/api/invitations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: 'Private API Invitation', expiresInDays: 7 }),
  });
  const proxiedInvitation = await proxiedInvitationResponse.json();
  checked(
    proxiedInvitationResponse.status === 201 && proxiedInvitation.inviteUrl.includes('#invite='),
    'private API creates invitations through the protected Edge Function',
  );
  const proxyRevokeResponse = await fetch(
    `${privateApiUrl}/api/invitations/${proxiedInvitation.id}/revoke`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
  );
  checked(proxyRevokeResponse.ok, 'private API revokes invitations through the protected bridge');
} catch (error) {
  if (apiLogs.length) console.error(apiLogs.join(''));
  throw error;
} finally {
  apiProcess.kill('SIGTERM');
  await new Promise((resolve) => {
    apiProcess.once('exit', resolve);
    setTimeout(resolve, 1_000);
  });
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

const revoked = await edge('invitations', {
  action: 'revoke',
  invitationId: invitation.payload.id,
});
checked(revoked.response.ok, 'admin Edge Function revokes the invitation and member');
const { data: afterRevoke, error: afterRevokeError } = await familyA
  .from('public_requests')
  .select('id');
assert.ifError(afterRevokeError);
checked(afterRevoke.length === 0, 'revocation immediately removes request access');

console.log(`Supabase local integration: ${checks.length} checks passed.`);
for (const check of checks) console.log(`✓ ${check}`);
