import { defineConfig, devices } from '@playwright/test';
import { join } from 'node:path';

const e2eDatabasePath = join(process.cwd(), 'services/concierge-api/data/media-concierge.e2e.db');

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:5175',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: 'npm run dev --workspace @media-concierge/api',
      url: 'http://127.0.0.1:4110/health',
      env: {
        CONCIERGE_API_PORT: '4110',
        CONCIERGE_DB_PATH: e2eDatabasePath,
        CORS_ORIGINS: 'http://127.0.0.1:5175,http://127.0.0.1:5176',
        MEDIA_CONCIERGE_DEMO_RESET_ENABLED: '1',
        MEDIA_CONCIERGE_SKIP_ENV_FILE: '1',
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'npm run dev --workspace @media-concierge/portal -- --host 127.0.0.1 --port 5175',
      url: 'http://127.0.0.1:5175',
      env: { VITE_CONCIERGE_API_URL: 'http://127.0.0.1:4110' },
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: 'npm run dev --workspace @media-concierge/admin -- --host 127.0.0.1 --port 5176',
      url: 'http://127.0.0.1:5176',
      env: { VITE_CONCIERGE_API_URL: 'http://127.0.0.1:4110' },
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
