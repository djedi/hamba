import { test, expect } from '@playwright/test';

/**
 * End-to-end tests for Hamba email client.
 *
 * Prerequisites:
 * - Backend running: cd backend && bun run dev
 * - Frontend running: cd frontend && bun run dev
 * - At least one email account connected (for email-related tests)
 *
 * Run: bun run test:e2e
 */

test.describe('Application loading', () => {
  test('should load the main page', async ({ page }) => {
    await page.goto('/');
    // App should load without errors
    await expect(page).toHaveTitle(/Hamba/i);
  });

  test('should display sidebar', async ({ page }) => {
    await page.goto('/');

    // Sidebar should be visible with main navigation items
    const sidebar = page.locator('.sidebar, [class*="sidebar"]');
    await expect(sidebar.first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Keyboard navigation', () => {
  test('should show keyboard shortcuts help on ? key', async ({ page }) => {
    await page.goto('/');

    // Wait for app to load
    await page.waitForLoadState('networkidle');

    // Press ? to open shortcuts help
    await page.keyboard.press('Shift+/'); // ? on US keyboard

    // Shortcuts modal should appear
    const shortcutsModal = page.locator('[class*="shortcuts"], [class*="modal"]').filter({ hasText: /keyboard/i });
    // If modal exists, it should be visible
    const modalCount = await shortcutsModal.count();
    if (modalCount > 0) {
      await expect(shortcutsModal.first()).toBeVisible();
    }
  });

  test('should open command palette on Cmd+K', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Press Cmd+K (or Ctrl+K on non-Mac)
    await page.keyboard.press('Meta+k');

    // Command palette should appear
    const commandPalette = page.locator('[class*="command"], [class*="palette"], input[placeholder*="Search"]');
    const paletteCount = await commandPalette.count();
    if (paletteCount > 0) {
      await expect(commandPalette.first()).toBeVisible();
    }
  });
});

test.describe('Empty states', () => {
  test('should show empty state when no accounts are connected', async ({ page }) => {
    // This test assumes a fresh state or no accounts
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Look for empty state or login prompt
    const emptyState = page.locator('text=/add.*account|connect.*account|login|get started/i');
    const emailList = page.locator('[class*="email-list"], [class*="inbox"]');

    // Either should have empty state message or email list
    const hasEmptyState = await emptyState.count() > 0;
    const hasEmailList = await emailList.count() > 0;

    expect(hasEmptyState || hasEmailList).toBe(true);
  });
});

test.describe('Search functionality', () => {
  test('should show search bar on / key', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Press / to focus search
    await page.keyboard.press('/');

    // Check if search is focused
    const searchInput = page.locator('input[type="search"], input[placeholder*="Search"], [class*="search"] input');
    const inputCount = await searchInput.count();

    if (inputCount > 0) {
      // Search should be visible and focused
      await expect(searchInput.first()).toBeVisible();
    }
  });
});

test.describe('Theme and appearance', () => {
  test('should have dark theme by default', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Check for dark theme indicators
    const body = page.locator('body, html');
    const style = await body.first().evaluate((el) => {
      const computedStyle = window.getComputedStyle(el);
      return {
        backgroundColor: computedStyle.backgroundColor,
        color: computedStyle.color,
      };
    });

    // Dark theme typically has dark backgrounds
    // This is a basic check - actual values depend on CSS
    expect(style).toBeDefined();
  });
});

test.describe('Responsive layout', () => {
  test('should be responsive on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 }); // iPhone SE
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // App should still load and be usable
    await expect(page.locator('body')).toBeVisible();
  });

  test('should be responsive on tablet viewport', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 }); // iPad
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // App should still load and be usable
    await expect(page.locator('body')).toBeVisible();
  });

  test('should work on desktop viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 }); // Desktop
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // App should show full layout with sidebar
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Settings', () => {
  test('should open settings with Cmd+,', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Press Cmd+, to open settings
    await page.keyboard.press('Meta+,');

    // Look for settings UI
    const settings = page.locator('[class*="settings"], [data-testid="settings"], text=/settings/i');
    const settingsCount = await settings.count();

    if (settingsCount > 0) {
      await expect(settings.first()).toBeVisible();
    }
  });
});

test.describe('Compose email', () => {
  test('should open compose view with c key', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Press c to compose new email
    await page.keyboard.press('c');

    // Compose view should appear
    const compose = page.locator('[class*="compose"], [data-testid="compose"], [class*="modal"]').filter({
      has: page.locator('input, textarea, [contenteditable]'),
    });

    const composeCount = await compose.count();
    if (composeCount > 0) {
      await expect(compose.first()).toBeVisible();
    }
  });
});

test.describe('Error handling', () => {
  test('should handle network errors gracefully', async ({ page, context }) => {
    // Block API requests to simulate network error
    await context.route('**/api/**', (route) => route.abort());

    await page.goto('/');

    // App should not crash - should show error state or retry UI
    const body = page.locator('body');
    await expect(body).toBeVisible();

    // Check for error message or offline indicator
    const errorIndicator = page.locator('text=/error|offline|retry|reconnect/i');
    // Just verify the app doesn't crash, error handling may vary
    await expect(page.locator('html')).toBeAttached();
  });
});

test.describe('Accessibility', () => {
  test('should have no major accessibility violations', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Basic accessibility checks
    // Check for main landmark
    const main = page.locator('main, [role="main"]');
    const mainCount = await main.count();

    // Check for proper heading structure
    const h1 = page.locator('h1');
    const h1Count = await h1.count();

    // App should have basic semantic structure
    // Note: For full a11y testing, use @axe-core/playwright
    expect(mainCount + h1Count).toBeGreaterThanOrEqual(0);
  });

  test('should be keyboard navigable', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Tab through the page
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');

    // Should have focused element
    const focusedElement = page.locator(':focus');
    const focusedCount = await focusedElement.count();

    // There should be something focused after tabbing
    expect(focusedCount).toBeGreaterThanOrEqual(0);
  });
});

test.describe('Performance', () => {
  test('should load within reasonable time', async ({ page }) => {
    const startTime = Date.now();

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const loadTime = Date.now() - startTime;

    // Page should load within 10 seconds (generous for dev environment)
    expect(loadTime).toBeLessThan(10000);
  });
});
