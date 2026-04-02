import { test, expect } from '../fixtures/base-test.js';
import { AppPage } from '../pages/AppPage.js';

test.describe('App Launch', () => {
  test('should display the app title', async ({ page }) => {
    const app = new AppPage(page);
    await expect(app.title).toHaveText('LLM OCR');
  });

  test('should show upload zone on initial load', async ({ page }) => {
    const app = new AppPage(page);
    await expect(app.uploadZone).toBeVisible();
  });

  test('should show hero subtitle when no images uploaded', async ({ page }) => {
    const subtitle = page.locator('.hero-subtitle');
    await expect(subtitle).toBeVisible();
  });

  test('should open settings dialog when settings button clicked', async ({ page }) => {
    const app = new AppPage(page);
    await app.openSettings();
    const dialog = page.locator('.settings-overlay');
    await expect(dialog).toBeVisible();
  });

  test('should toggle dark/light theme', async ({ page }) => {
    const themeToggle = page.locator('button[aria-label*="切换"]');
    const html = page.locator('html');

    const initialTheme = await html.getAttribute('data-theme');
    await themeToggle.click();
    const newTheme = await html.getAttribute('data-theme');

    expect(newTheme).not.toBe(initialTheme);
  });
});
