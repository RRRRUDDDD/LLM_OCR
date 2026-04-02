import { test as base } from '@playwright/test';
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await use(page);
  },
});

export { expect } from '@playwright/test';
