import Dexie, { type Table, type Transaction } from 'dexie';
import { isWebkit } from '../utils/browser';
import type { FigureRecord, ImageBlobRecord, OcrResultRecord, SettingRecord, StoredPage } from '../types/page';

type LegacyOcrRecord = OcrResultRecord & { _imageBlob?: Blob | ArrayBuffer };
type LegacyImageBlobRecord = ImageBlobRecord & { mimeType?: string };

function generateId(prefix = 'item'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const arr = new Uint32Array(2);
    crypto.getRandomValues(arr);
    return `${prefix}_${Date.now()}_${arr[0].toString(36)}_${arr[1].toString(36)}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

class OcrDatabase extends Dexie {
  images!: Table<StoredPage, string>;
  ocrResults!: Table<OcrResultRecord, string>;
  imageBlobs!: Table<ImageBlobRecord, string>;
  settings!: Table<SettingRecord, string>;
  figures!: Table<FigureRecord, string>;

  constructor() {
    super('LLM_OCR');

    this.version(1).stores({
      images:     'id, fileName, status, order, createdAt',
      ocrResults: 'imageId',
      settings:   'key',
    });

    // v2: separate imageBlobs table to eliminate race condition
    // between saveImageBlob and saveOcrResult sharing ocrResults
    this.version(2).stores({
      images:     'id, fileName, status, order, createdAt',
      ocrResults: 'imageId',
      imageBlobs: 'imageId',
      settings:   'key',
    }).upgrade(async (tx: Transaction) => {
      // Migrate _imageBlob from ocrResults to imageBlobs
      const ocrResults = await tx.table<LegacyOcrRecord, string>('ocrResults').toArray();
      const blobEntries: ImageBlobRecord[] = [];
      const cleanedResults: OcrResultRecord[] = [];

      for (const record of ocrResults) {
        if (record._imageBlob) {
          blobEntries.push({
            imageId: record.imageId,
            data: record._imageBlob,
          });
        }
        // Remove _imageBlob from ocrResults record
        const { _imageBlob, ...rest } = record;
        cleanedResults.push(rest);
      }

      // Write blobs to new table
      if (blobEntries.length > 0) {
        await tx.table<ImageBlobRecord, string>('imageBlobs').bulkPut(blobEntries);
      }

      // Update ocrResults without _imageBlob
      if (cleanedResults.length > 0) {
        await tx.table<OcrResultRecord, string>('ocrResults').bulkPut(cleanedResults);
      }
    });

    this.version(3).stores({
      images:     'id, fileName, status, order, createdAt',
      ocrResults: 'imageId',
      imageBlobs: 'imageId',
      settings:   'key',
    }).upgrade(async (tx: Transaction) => {
      const [imageBlobs, images] = await Promise.all([
        tx.table<LegacyImageBlobRecord, string>('imageBlobs').toArray(),
        tx.table<StoredPage, string>('images').toArray(),
      ]);

      const mimeByImageId = new Map(images.map((image) => [image.id, image.fileType || 'image/png']));
      const patched = imageBlobs.map((record) => ({
        ...record,
        mimeType: record.mimeType || (record.data instanceof Blob ? record.data.type : mimeByImageId.get(record.imageId) || 'image/png'),
      }));

      if (patched.length > 0) {
        await tx.table<ImageBlobRecord, string>('imageBlobs').bulkPut(patched);
      }
    });

    // v4: figures table for illustrations cropped from book pages (bbox from VLM)
    this.version(4).stores({
      images:     'id, fileName, status, order, createdAt',
      ocrResults: 'imageId',
      imageBlobs: 'imageId',
      settings:   'key',
      figures:    'id, pageId',
    });
  }

  private async createStoredPageRecord(imageData: Partial<StoredPage>): Promise<StoredPage> {
    return {
      id: imageData.id || generateId('img'),
      fileName: imageData.fileName || 'unknown',
      fileSize: imageData.fileSize || 0,
      fileType: imageData.fileType || 'image/png',
      status: imageData.status || 'idle',
      ocrText: imageData.ocrText || '',
      thumbnailUrl: imageData.thumbnailUrl || '',
      order: imageData.order ?? await this.getNextOrder(),
      sourceFile: imageData.sourceFile,
      pageNumber: imageData.pageNumber,
      createdAt: imageData.createdAt || new Date(),
      updatedAt: new Date(),
    };
  }

  // Safari/WebKit can corrupt Blobs persisted in IndexedDB — store ArrayBuffers there.
  private async toStorableData(blob: Blob): Promise<Blob | ArrayBuffer> {
    return isWebkit() ? await blob.arrayBuffer() : blob;
  }

  toImageBlob(record?: ImageBlobRecord): Blob | undefined {
    if (!record || !record.data) return undefined;
    const data = record.data;
    const mimeType = record.mimeType || (data instanceof Blob ? data.type : 'image/png');
    if (data instanceof ArrayBuffer || (data && typeof data === 'object' && 'byteLength' in data)) {
      return new Blob([data], { type: mimeType });
    }
    return data;
  }


  async saveImageWithBlob(imageData: Partial<StoredPage>, blob: Blob): Promise<string> {
    const record = await this.createStoredPageRecord(imageData);
    const dataToSave = await this.toStorableData(blob);

    await this.transaction('rw', this.images, this.imageBlobs, async () => {
      await this.images.put(record);
      await this.imageBlobs.put({
        imageId: record.id,
        data: dataToSave,
        mimeType: blob.type || record.fileType || 'image/png',
      });
    });

    return record.id;
  }

  async getImageBlob(imageId: string): Promise<Blob | undefined> {
    const record = await this.imageBlobs.get(imageId);
    return this.toImageBlob(record);
  }

  async bulkUpdateImages(entries: Array<{ id: string; updates: Partial<StoredPage> }>): Promise<void> {
    if (entries.length === 0) return;

    await this.transaction('rw', this.images, async () => {
      const timestamp = new Date();
      await Promise.all(entries.map(({ id, updates }) => (
        this.images.update(id, { ...updates, updatedAt: timestamp })
      )));
    });
  }

  // Used by the e2e suite to inspect persisted state.
  async getImage(id: string): Promise<StoredPage | undefined> {
    return await this.images.get(id);
  }

  async getAllImages(): Promise<StoredPage[]> {
    return await this.images.orderBy('order').toArray();
  }

  async deleteImage(id: string): Promise<void> {
    await this.transaction('rw', this.images, this.ocrResults, this.imageBlobs, this.figures, async () => {
      await this.images.delete(id);
      await this.ocrResults.delete(id);
      await this.imageBlobs.delete(id);
      await this.figures.where('pageId').equals(id).delete();
    });
  }

  async deleteAllImages(): Promise<void> {
    await this.transaction('rw', this.images, this.ocrResults, this.imageBlobs, this.figures, async () => {
      await this.images.clear();
      await this.ocrResults.clear();
      await this.imageBlobs.clear();
      await this.figures.clear();
    });
    this.orderCounter = 0;
  }

  // ── Figures ──

  /** Replace all figures of a page atomically (idempotent on re-OCR). */
  async replaceFiguresForPage(pageId: string, figures: Array<Omit<FigureRecord, 'data'> & { blob: Blob }>): Promise<void> {
    const records: FigureRecord[] = await Promise.all(figures.map(async ({ blob, ...rest }) => ({
      ...rest,
      data: await this.toStorableData(blob),
    })));

    await this.transaction('rw', this.figures, async () => {
      await this.figures.where('pageId').equals(pageId).delete();
      if (records.length > 0) {
        await this.figures.bulkPut(records);
      }
    });
  }

  async getFiguresByPageIds(pageIds: string[]): Promise<FigureRecord[]> {
    if (pageIds.length === 0) return [];
    return await this.figures.where('pageId').anyOf(pageIds).toArray();
  }

  toFigureBlob(record: FigureRecord): Blob {
    const data = record.data;
    if (data instanceof Blob) return data;
    return new Blob([data], { type: record.mimeType || 'image/jpeg' });
  }

  // ── OCR Results ──

  // Used by the e2e suite to seed persisted state.
  async saveOcrResult(
    imageId: string,
    result: Pick<OcrResultRecord, 'text'> & Partial<Omit<OcrResultRecord, 'imageId' | 'text'>>
  ): Promise<void> {
    await this.ocrResults.put({
      imageId,
      text: result.text || '',
      rawText: result.rawText || '',
      status: result.status || 'done',
      createdAt: result.createdAt || new Date(),
    });
  }

  async bulkSaveOcrResults(
    entries: Array<{
      imageId: string;
      result: Pick<OcrResultRecord, 'text'> & Partial<Omit<OcrResultRecord, 'imageId' | 'text'>>;
    }>
  ): Promise<void> {
    if (entries.length === 0) return;

    await this.ocrResults.bulkPut(entries.map(({ imageId, result }) => ({
      imageId,
      text: result.text || '',
      rawText: result.rawText || '',
      status: result.status || 'done',
      createdAt: result.createdAt || new Date(),
    })));
  }

  async getAllOcrResults(): Promise<OcrResultRecord[]> {
    return await this.ocrResults.toArray();
  }

  async bulkDeleteOcrResults(imageIds: string[]): Promise<void> {
    if (imageIds.length === 0) return;
    await this.ocrResults.bulkDelete(imageIds);
  }

  // ── Order Counter ──

  // Cached after the first read: bulk additions (multi-page PDFs) would
  // otherwise issue one indexed query per page.
  private orderCounter: number | null = null;
  private orderCounterInit: Promise<void> | null = null;

  async getNextOrder(): Promise<number> {
    if (this.orderCounter === null) {
      // Use max(order) + 1 instead of count(): after deletions, count() can
      // collide with an existing order and make orderBy('order') unstable.
      this.orderCounterInit ??= this.images.orderBy('order').last().then((last) => {
        this.orderCounter ??= typeof last?.order === 'number' ? last.order + 1 : 0;
      });
      await this.orderCounterInit;
    }
    return this.orderCounter!++;
  }
}

export const db = new OcrDatabase();
export { generateId };
