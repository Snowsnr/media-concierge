import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

const localEnvironment = fileURLToPath(new URL('../../../.env.local', import.meta.url));

if (existsSync(localEnvironment)) loadEnvFile(localEnvironment);
