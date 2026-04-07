import { test, expect } from '@playwright/test';

test.describe('Bootstrap Flow', () => {
  test('restores the first saved page as current selection', async ({ page }) => {
    await page.addInitScript(async () => {
      localStorage.clear();
      localStorage.setItem('ocr-api-config', JSON.stringify({ apiKey: 'persisted-key', model: 'gpt-4o-mini' }));
      indexedDB.deleteDatabase('LLM_OCR');

      const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5W0XQAAAAASUVORK5CYII=';
      const thumbnailUrl = `data:image/png;base64,${pngBase64}`;
      const pngBytes = Uint8Array.from(atob(pngBase64), (char) => char.charCodeAt(0));
      const blob = new Blob([pngBytes], { type: 'image/png' });
      const now = new Date();

      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('LLM_OCR', 3);

        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('images')) {
            db.createObjectStore('images', { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains('ocrResults')) {
            db.createObjectStore('ocrResults', { keyPath: 'imageId' });
          }
          if (!db.objectStoreNames.contains('imageBlobs')) {
            db.createObjectStore('imageBlobs', { keyPath: 'imageId' });
          }
          if (!db.objectStoreNames.contains('settings')) {
            db.createObjectStore('settings', { keyPath: 'key' });
          }
        };

        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(['images', 'ocrResults', 'imageBlobs'], 'readwrite');
          tx.objectStore('images').put({
            id: 'seed-page-1',
            fileName: 'seed.png',
            fileSize: blob.size,
            fileType: 'image/png',
            status: 'done',
            ocrText: 'Recovered OCR text',
            thumbnailUrl: '',
            order: 0,
            createdAt: now,
            updatedAt: now,
          });
          tx.objectStore('ocrResults').put({
            imageId: 'seed-page-1',
            text: 'Recovered OCR text',
            rawText: 'Recovered OCR text',
            status: 'done',
            createdAt: now,
          });
          tx.objectStore('imageBlobs').put({
            imageId: 'seed-page-1',
            data: blob,
            mimeType: 'image/png',
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        };

        request.onerror = () => reject(request.error);
      });
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.image-counter')).toHaveText('1 / 1');
    await expect(page.locator('.result-card')).toContainText('Recovered OCR text');
  });

  test('opens settings dialog on first launch without API key', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear();
      indexedDB.deleteDatabase('LLM_OCR');
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.settings-overlay')).toBeVisible();
  });

  test('restores saved config and theme from storage', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear();
      localStorage.setItem('ocr-api-config', JSON.stringify({ apiKey: 'persisted-key', model: 'gpt-4o-mini' }));
      localStorage.setItem('ocr-theme', 'dark');
      indexedDB.deleteDatabase('LLM_OCR');
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.settings-overlay')).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('only keeps a small window of restored images mounted at once', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.evaluate(async () => {
      // @ts-expect-error Runtime-only Vite module import inside browser context.
      const { db } = await import('/src/db/index.ts');

      localStorage.clear();
      localStorage.setItem('ocr-api-config', JSON.stringify({ apiKey: 'persisted-key', model: 'gpt-4o-mini' }));

      const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5W0XQAAAAASUVORK5CYII=';
      const thumbnailUrl = `data:image/png;base64,${pngBase64}`;
      const pngBytes = Uint8Array.from(atob(pngBase64), (char) => char.charCodeAt(0));
      const blob = new Blob([pngBytes], { type: 'image/png' });
      const now = new Date();

      await db.deleteAllImages();

      for (let index = 0; index < 10; index++) {
        const id = `seed-page-${index + 1}`;
        await db.saveImageWithBlob({
          id,
          fileName: `seed-${index + 1}.png`,
          fileSize: blob.size,
          fileType: 'image/png',
          status: 'done',
          ocrText: `Recovered OCR text ${index + 1}`,
          thumbnailUrl,
          order: index,
          createdAt: now,
          updatedAt: now,
        }, blob);
        await db.saveOcrResult(id, {
          text: `Recovered OCR text ${index + 1}`,
          rawText: `Recovered OCR text ${index + 1}`,
          status: 'done',
          createdAt: now,
        });
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.image-counter')).toHaveText('1 / 10');
    await expect(page.getByRole('button', { name: 'Export options' })).toHaveCount(2);
    await expect(page.locator('.page-thumbnail__img')).toHaveCount(10);
    const blobImageCount = await page.evaluate(() => (
      Array.from(document.querySelectorAll('img'))
        .map((img) => img.getAttribute('src') || '')
        .filter((src) => src.startsWith('blob:')).length
    ));
    expect(blobImageCount).toBe(1);
  });

  test('renders a placeholder preview for restored PDF entries', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.evaluate(async () => {
      // @ts-expect-error Runtime-only Vite module import inside browser context.
      const { db } = await import('/src/db/index.ts');

      localStorage.clear();
      localStorage.setItem('ocr-api-config', JSON.stringify({ apiKey: 'persisted-key', provider: 'deepseek_ocr_api' }));

      const now = new Date();
      const pdfBlob = new Blob(['%PDF-1.4 test'], { type: 'application/pdf' });

      await db.deleteAllImages();
      await db.saveImageWithBlob({
        id: 'pdf-page-1',
        fileName: 'sample.pdf',
        fileSize: pdfBlob.size,
        fileType: 'application/pdf',
        status: 'done',
        ocrText: 'Recovered PDF OCR text',
        thumbnailUrl: '',
        order: 0,
        createdAt: now,
        updatedAt: now,
      }, pdfBlob);
      await db.saveOcrResult('pdf-page-1', {
        text: 'Recovered PDF OCR text',
        rawText: 'Recovered PDF OCR text',
        status: 'done',
        createdAt: now,
      });
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.image-preview__placeholder')).toContainText('sample.pdf');
    await expect(page.locator('.image-preview__placeholder .material-icons-round')).toHaveText('picture_as_pdf');
  });
});
