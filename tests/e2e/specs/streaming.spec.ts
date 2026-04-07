import { test, expect } from '../fixtures/base-test';

test.describe('Streaming Progress', () => {
  test('coalesces rapid OCR progress updates before notifying the UI', async ({ page }) => {
    const result = await page.evaluate(async () => {
      // @ts-expect-error Runtime-only Vite module import inside browser context.
      const { createProgressEmitter, PROGRESS_EMIT_INTERVAL_MS } = await import('/src/services/ocrService.ts');
      // @ts-expect-error Runtime-only Vite module import inside browser context.
      const { ocrEvents } = await import('/src/events/ocrEvents.ts');

      const emissions: string[] = [];
      const handler = ({ text }: { text: string }) => emissions.push(text);
      ocrEvents.on('ocr:progress', handler);

      try {
        const emitter = createProgressEmitter('stream-test');
        emitter.push('a');
        emitter.push('ab');
        emitter.push('abc');
        await new Promise((resolve) => setTimeout(resolve, PROGRESS_EMIT_INTERVAL_MS + 25));

        emitter.push('abcd');
        emitter.push('abcde');
        emitter.flush();

        return emissions;
      } finally {
        ocrEvents.off('ocr:progress', handler);
      }
    });

    expect(result).toEqual(['abc', 'abcde']);
  });
});
