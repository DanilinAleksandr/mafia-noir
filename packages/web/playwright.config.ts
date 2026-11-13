/**
 * e2e-тесты и скриншоты. Браузер — установленный Chrome (channel: 'chrome'): скачивать браузеры
 * Playwright не нужно. Другой канал: PW_CHANNEL=chromium (после `npx playwright install chromium`).
 *
 * Серверы поднимаются сами (или переиспользуются, если уже запущены): wrangler dev на 8787
 * и Vite на 5173.
 */
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const channel = process.env.PW_CHANNEL ?? 'chrome';
const root = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  testDir: './e2e',
  timeout: 240_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    ...devices['Pixel 7'],
    channel,
    baseURL: 'http://127.0.0.1:5173',
    locale: 'ru-RU',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'e2e', testMatch: /.*\.e2e\.ts/ },
    { name: 'screens', testMatch: /screens\.ts/ },
  ],
  webServer: [
    {
      command: 'npm run dev:server',
      cwd: root,
      port: 8787,
      reuseExistingServer: true,
      timeout: 120_000,
      env: { NO_PROXY: '127.0.0.1,localhost' },
    },
    {
      command: 'npm run dev:web',
      cwd: root,
      port: 5173,
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
