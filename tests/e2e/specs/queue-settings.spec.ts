import { test, expect } from '../fixtures/base-test';
import { AppPage } from '../pages/AppPage';

test.describe('Queue throttling settings', () => {
  test('configure() applies valid values and ignores invalid ones', async ({ page }) => {
    const result = await page.evaluate(async () => {
      // @ts-expect-error Runtime-only Vite module import inside browser context.
      const { queueManager } = await import('/src/services/queueManager.ts');

      const initial = queueManager.getConfig();
      queueManager.configure({ concurrency: 5, requestsPerMinute: 30 });
      const applied = queueManager.getConfig();
      queueManager.configure({ concurrency: 0, requestsPerMinute: -10 });
      const afterInvalid = queueManager.getConfig();
      queueManager.configure({ concurrency: 3, requestsPerMinute: 0 }); // restore defaults

      return { initial, applied, afterInvalid };
    });

    expect(result.initial).toEqual({ concurrency: 3, requestsPerMinute: 0 });
    expect(result.applied).toEqual({ concurrency: 5, requestsPerMinute: 30 });
    expect(result.afterInvalid).toEqual({ concurrency: 5, requestsPerMinute: 30 });
  });

  test('rate limiter holds back task starts beyond the per-minute budget', async ({ page }) => {
    const result = await page.evaluate(async () => {
      // @ts-expect-error Runtime-only Vite module import inside browser context.
      const { queueManager } = await import('/src/services/queueManager.ts');
      // @ts-expect-error Runtime-only Vite module import inside browser context.
      const { ocrEvents } = await import('/src/events/ocrEvents.ts');

      const started: string[] = [];
      const onStart = ({ imageId }: { imageId: string }) => started.push(imageId);
      ocrEvents.on('ocr:start', onStart);

      queueManager.configure({ concurrency: 3, requestsPerMinute: 2 });
      try {
        for (const id of ['rate-1', 'rate-2', 'rate-3']) {
          queueManager.add(id, async () => undefined);
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
        return { startedWithinBudget: [...started], thirdHeld: !started.includes('rate-3') };
      } finally {
        ocrEvents.off('ocr:start', onStart);
        queueManager.cancelAll();
        queueManager.configure({ concurrency: 3, requestsPerMinute: 0 });
      }
    });

    expect(result.startedWithinBudget).toEqual(['rate-1', 'rate-2']);
    expect(result.thirdHeld).toBe(true);
  });

  test('settings dialog saves concurrency and requests-per-minute', async ({ page }) => {
    const app = new AppPage(page);
    await app.openSettings();

    await page.locator('#settings-concurrency').fill('2');
    await page.locator('#settings-requests-per-minute').fill('15');
    await page.getByRole('button', { name: /保存|Save/ }).click();

    await expect(app.snackbar).toBeVisible();

    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('ocr-api-config') || '{}'));
    expect(stored.concurrency).toBe(2);
    expect(stored.requestsPerMinute).toBe(15);

    const queueConfig = await page.evaluate(async () => {
      // @ts-expect-error Runtime-only Vite module import inside browser context.
      const { queueManager } = await import('/src/services/queueManager.ts');
      return queueManager.getConfig();
    });
    expect(queueConfig).toEqual({ concurrency: 2, requestsPerMinute: 15 });
  });
});
