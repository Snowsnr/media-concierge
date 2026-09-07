import { chmod, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { webcrypto } from 'node:crypto';

const output = resolve('.vapid-secrets.env');
if (existsSync(output) && !process.argv.includes('--force')) {
  console.error('.vapid-secrets.env already exists; use --force only to rotate the key.');
  process.exit(1);
}

const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
  'sign',
  'verify',
]);
const privateJwk = await webcrypto.subtle.exportKey('jwk', pair.privateKey);
const contents = [
  `VAPID_PRIVATE_JWK='${JSON.stringify(privateJwk)}'`,
  'VAPID_SUBJECT=https://pedidos.diegohomelab.fyi',
  '',
].join('\n');
await writeFile(output, contents, { encoding: 'utf8', mode: 0o600 });
await chmod(output, 0o600);
console.log('Created .vapid-secrets.env (private, gitignored).');
