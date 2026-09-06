import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

const localEnvironment = fileURLToPath(new URL('../../../.env.local', import.meta.url));

if (process.env.MEDIA_CONCIERGE_SKIP_ENV_FILE !== '1' && existsSync(localEnvironment)) {
  loadEnvFile(localEnvironment);
}
