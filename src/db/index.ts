import Dexie, { type Table, type Transaction } from 'dexie';
import { isWebkit } from '../utils/browser';
import type { ImageBlobRecord, OcrResultRecord, SettingRecord, StoredPage } from '../types/page';

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
  }


  async saveImage(imageData: Partial<StoredPage>): Promise<string> {
    const record: StoredPage = {
      id: imageData.id || generateId('img'),
      fileName: imageData.fileName || 'unknown',
      fileSize: imageData.fileSize || 0,
      fileType: imageData.fileType || 'image/png',
      status: imageData.status || 'idle',
      ocrText: imageData.ocrText || '',
      thumbnailUrl: imageData.thumbnailUrl || '',
      order: imageData.order ?? await this.getNextOrder(),
      createdAt: imageData.createdAt || new Date(),
      updatedAt: new Date(),
    };
    await this.images.put(record);
    return record.id;
  }

  async saveImageBlob(imageId: string, blob: Blob): Promise<void> {
    let dataToSave: Blob | ArrayBuffer = blob;
    if (isWebkit() && blob instanceof Blob) {
      dataToSave = await blob.arrayBuffer();
    }
    await this.imageBlobs.put({ imageId, data: dataToSave, mimeType: blob.type || 'image/png' });
  }

  async getImageBlob(imageId: string): Promise<Blob | undefined> {
    const record = await this.imageBlobs.get(imageId);
    if (!record || !record.data) return undefined;
    const data = record.data;
    const mimeType = record.mimeType || (data instanceof Blob ? data.type : 'image/png');
    if (data instanceof ArrayBuffer || (data && typeof data === 'object' && 'byteLength' in data)) {
      return new Blob([data], { type: mimeType });
    }
    return data;
  }

  async updateImage(id: string, updates: Partial<StoredPage>): Promise<number> {
    return await this.images.update(id, { ...updates, updatedAt: new Date() });
  }

  async getImage(id: string): Promise<StoredPage | undefined> {
    return await this.images.get(id);
  }

  async getAllImages(): Promise<StoredPage[]> {
    return await this.images.orderBy('order').toArray();
  }

  async deleteImage(id: string): Promise<void> {
    await this.transaction('rw', this.images, this.ocrResults, this.imageBlobs, async () => {
      await this.images.delete(id);
      await this.ocrResults.delete(id);
      await this.imageBlobs.delete(id);
    });
  }

  async deleteAllImages(): Promise<void> {
    await this.transaction('rw', this.images, this.ocrResults, this.imageBlobs, async () => {
      await this.images.clear();
      await this.ocrResults.clear();
      await this.imageBlobs.clear();
    });
  }

  // ── OCR Results ──

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

  async getOcrResult(imageId: string): Promise<Omit<OcrResultRecord, 'imageId' | 'createdAt'> | undefined> {
    const record = await this.ocrResults.get(imageId);
    if (!record) return undefined;
    return { text: record.text, rawText: record.rawText, status: record.status };
  }

  async deleteOcrResult(imageId: string): Promise<void> {
    await this.ocrResults.delete(imageId);
  }

  // ── Settings ──

  async saveSetting(key: string, value: unknown): Promise<void> {
    await this.settings.put({ key, value });
  }

  async getSetting<T = unknown>(key: string): Promise<T | undefined> {
    const record = await this.settings.get(key);
    return record?.value as T | undefined;
  }

  // ── Order Counter ──

  async getNextOrder(): Promise<number> {
    const count = await this.images.count();
    return count;
  }
}

export const db = new OcrDatabase();
export { generateId };
