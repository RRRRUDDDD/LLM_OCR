import { test, expect } from '../fixtures/base-test';

test.describe('Persistence', () => {
  test('rolls back image metadata when blob persistence fails', async ({ page }) => {
    const result = await page.evaluate(async () => {
      // @ts-expect-error Runtime-only Vite module import inside browser context.
      const { db } = await import('/src/db/index.ts');

      const originalPut = db.imageBlobs.put.bind(db.imageBlobs);
      db.imageBlobs.put = async () => {
        throw new Error('Simulated blob write failure');
      };

      const now = new Date();
      const blob = new Blob(['image-bytes'], { type: 'image/png' });

      try {
        await db.saveImageWithBlob({
          id: 'tx-failure-page',
          fileName: 'tx-failure.png',
          fileSize: blob.size,
          fileType: 'image/png',
          status: 'idle',
          ocrText: '',
          createdAt: now,
          updatedAt: now,
        }, blob);
      } catch {
        // Expected failure path
      } finally {
        db.imageBlobs.put = originalPut;
      }

      const imageRecord = await db.getImage('tx-failure-page');
      const blobRecord = await db.getImageBlob('tx-failure-page');

      return {
        hasImageRecord: Boolean(imageRecord),
        hasBlobRecord: Boolean(blobRecord),
      };
    });

    expect(result.hasImageRecord).toBe(false);
    expect(result.hasBlobRecord).toBe(false);
  });
});
