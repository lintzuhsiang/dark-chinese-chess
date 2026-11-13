import { defineConfig } from '@playwright/test';

// Inspector is intentionally absent from the production preview used by the
// existing gameplay suite. Exercise it against the development server instead.
export default defineConfig({
  testDir: './e2e-replay',
  outputDir: './test-results-replay',
  timeout: 60_000,
  workers: 1,
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  use: {
    baseURL: 'http://127.0.0.1:5187',
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5187 --strictPort',
    cwd: './apps/web',
    url: 'http://127.0.0.1:5187',
    reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 1000 },
  },
});
