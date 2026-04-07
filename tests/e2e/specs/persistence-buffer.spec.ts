import { test, expect } from '../fixtures/base-test';

test.describe('Persistence Buffer', () => {
  test('coalesces rapid page persistence writes into batched operations', async ({ page }) => {
    const result = await page.evaluate(async () => {
      // @ts-expect-error Runtime-only Vite module import inside browser context.
      const { createPagePersistenceBuffer } = await import('/src/services/pagePersistence.ts');

      const calls = {
        imageUpdates: [] as Array<Array<{ id: string; updates: Record<string, unknown> }>>,
        ocrSaves: [] as Array<Array<{ imageId: string; result: Record<string, unknown> }>>,
        ocrDeletes: [] as Array<string[]>,
      };

      const buffer = createPagePersistenceBuffer({
        async bulkUpdateImages(entries: Array<{ id: string; updates: Record<string, unknown> }>) {
          calls.imageUpdates.push(entries.map((entry) => ({ id: entry.id, updates: entry.updates })));
        },
        async bulkSaveOcrResults(entries: Array<{ imageId: string; result: Record<string, unknown> }>) {
          calls.ocrSaves.push(entries.map((entry) => ({ imageId: entry.imageId, result: entry.result })));
        },
        async bulkDeleteOcrResults(imageIds: string[]) {
          calls.ocrDeletes.push([...imageIds]);
        },
      }, () => undefined, 10);

      buffer.queueImageUpdate('page-1', { status: 'queued' });
      buffer.queueImageUpdate('page-1', { status: 'processing' });
      buffer.queueImageUpdate('page-1', { status: 'done', ocrText: 'final text' });
      buffer.queueOcrSave('page-1', { text: 'final text', rawText: 'final text', status: 'done' });
      buffer.queueOcrDelete('page-2');

      await new Promise((resolve) => setTimeout(resolve, 30));
      await buffer.dispose();

      return calls;
    });

    expect(result.imageUpdates).toHaveLength(1);
    expect(result.imageUpdates[0]).toEqual([
      { id: 'page-1', updates: { status: 'done', ocrText: 'final text' } },
    ]);
    expect(result.ocrSaves).toHaveLength(1);
    expect(result.ocrSaves[0][0].imageId).toBe('page-1');
    expect(result.ocrSaves[0][0].result.text).toBe('final text');
    expect(result.ocrDeletes).toEqual([['page-2']]);
  });
});
