import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './verification',
  testMatch: 'performance.measure.ts',
  outputDir: './performance-results',
  timeout: 180_000,
  workers: 1,
  projects: [
    { name: 'desktop-chromium', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'touch-viewport-chromium', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
  ],
  use: { browserName: 'chromium', baseURL: 'http://127.0.0.1:5186' },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 5186 --strictPort',
    cwd: './apps/web',
    url: 'http://127.0.0.1:5186',
    reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 1000 },
  },
});
