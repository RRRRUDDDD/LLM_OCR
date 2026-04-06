import { test as base } from '@playwright/test';
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      localStorage.clear();
      localStorage.setItem('ocr-api-config', JSON.stringify({ apiKey: 'playwright-test-key' }));
      localStorage.setItem('ocr-theme', 'light');
      indexedDB.deleteDatabase('LLM_OCR');
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await use(page);
  },
});

export { expect } from '@playwright/test';
