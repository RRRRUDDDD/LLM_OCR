import { test, expect } from '../fixtures/base-test';
import { AppPage } from '../pages/AppPage';

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
    const themeToggle = page.getByRole('button', { name: /切换|Switch to/ });
    const html = page.locator('html');

    const initialTheme = await html.getAttribute('data-theme');
    await themeToggle.click();
    const newTheme = await html.getAttribute('data-theme');

    expect(newTheme).not.toBe(initialTheme);
  });

  test('should preserve provider-specific drafts when switching providers in settings', async ({ page }) => {
    const app = new AppPage(page);
    await app.openSettings();

    const provider = page.locator('#settings-provider');
    const baseUrl = page.locator('#settings-base-url');
    const model = page.locator('#settings-model');

    await provider.selectOption('openai_compatible');
    await baseUrl.fill('https://custom-openai.example/v1');
    await model.fill('custom-openai-model');

    await provider.selectOption('gemini_native');
    await baseUrl.fill('https://custom-gemini.example/v1beta');
    await model.fill('custom-gemini-model');

    await provider.selectOption('openai_compatible');
    await expect(baseUrl).toHaveValue('https://custom-openai.example/v1');
    await expect(model).toHaveValue('custom-openai-model');
  });
});
