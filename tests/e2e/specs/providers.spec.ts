import { test, expect } from '../fixtures/base-test';

test.describe('Providers', () => {
  test('builds multipart OCR requests for DeepSeek-OCR provider', async ({ page }) => {
    const result = await page.evaluate(async () => {
      // @ts-expect-error Runtime-only Vite module import inside browser context.
      const { buildRequest } = await import('/src/services/ocrService.ts');

      const file = new File([new Blob(['hello'], { type: 'image/png' })], 'sample.png', { type: 'image/png' });
      const payload = buildRequest({
        provider: 'deepseek_ocr_api',
        baseUrl: 'https://api.deepseek-ocr.ai/v1/ocr',
        apiKey: 'token',
        model: '',
        prompt: 'extract text',
        ocrLanguage: 'auto',
      }, { file });

      const entries = Array.from((payload.body as FormData).entries()).map(([key, value]) => [
        key,
        value instanceof File ? value.name : String(value),
      ]);

      return {
        url: payload.url,
        hasAuthHeader: payload.headers.Authorization === 'Bearer token',
        hasContentTypeHeader: 'Content-Type' in payload.headers,
        entries,
      };
    });

    expect(result.url).toBe('https://api.deepseek-ocr.ai/v1/ocr');
    expect(result.hasAuthHeader).toBe(true);
    expect(result.hasContentTypeHeader).toBe(false);
    expect(result.entries).toEqual([
      ['file', 'sample.png'],
      ['prompt', 'extract text'],
      ['language', 'auto'],
    ]);
  });
});
