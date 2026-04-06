import { test, expect } from '../fixtures/base-test';

test.describe('Image Compression', () => {
  test('compresses oversized PNG uploads before OCR request encoding', async ({ page }) => {
    const result = await page.evaluate(async () => {
      // @ts-expect-error Runtime-only Vite module import inside browser context.
      const { default: compressImage } = await import('/src/utils/compressImage.ts');

      const canvas = document.createElement('canvas');
      canvas.width = 2600;
      canvas.height = 2600;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('2D canvas context unavailable');

      const imageData = ctx.createImageData(canvas.width, canvas.height);
      const { data } = imageData;

      const random = new Uint8Array(data.length);
      const chunkSize = 65_536;
      for (let offset = 0; offset < random.length; offset += chunkSize) {
        crypto.getRandomValues(random.subarray(offset, Math.min(offset + chunkSize, random.length)));
      }

      for (let i = 0; i < data.length; i += 4) {
        data[i] = random[i];
        data[i + 1] = random[i + 1];
        data[i + 2] = random[i + 2];
        data[i + 3] = 255;
      }
      ctx.putImageData(imageData, 0, 0);

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((value) => {
          if (value) resolve(value);
          else reject(new Error('Failed to build PNG test blob'));
        }, 'image/png');
      });

      const file = new File([blob], 'large.png', { type: 'image/png' });
      const compressed = await compressImage(file);

      const estimatedOutputBytes = Math.ceil((compressed.base64.length * 3) / 4);

      return {
        inputBytes: file.size,
        outputBytes: estimatedOutputBytes,
        mimeType: compressed.mimeType,
      };
    });

    expect(result.inputBytes).toBeGreaterThan(1_048_576);
    expect(result.mimeType).not.toBe('image/png');
    expect(result.outputBytes).toBeLessThan(result.inputBytes);
  });
});
