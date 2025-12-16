import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for E2E tests
 * Run with: bun run test:e2e
 *
 * Tests require both backend and frontend to be running:
 * - Backend: cd backend && bun run dev (port 8877)
 * - Frontend: cd frontend && bun run dev (port 8878)
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { open: 'never' }], ['list']],

  use: {
    baseURL: 'http://localhost:8878',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Don't auto-start dev servers - tests expect servers to already be running
  // This allows tests to run against the development environment or CI builds
  webServer: undefined,
});
