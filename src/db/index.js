import Dexie from 'dexie';
import { isWebkit } from '../utils/browser';

function generateId(prefix = 'item') {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const arr = new Uint32Array(2);
    crypto.getRandomValues(arr);
    return `${prefix}_${Date.now()}_${arr[0].toString(36)}_${arr[1].toString(36)}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

class OcrDatabase extends Dexie {
  constructor() {
    super('LLM_OCR');

    this.version(1).stores({
      images:     'id, fileName, status, order, createdAt',
      ocrResults: 'imageId',
      settings:   'key',
    });
  }


  async saveImage(imageData) {
    const record = {
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

  async saveImageBlob(imageId, blob) {
    let dataToSave = blob;
    if (isWebkit() && blob instanceof Blob) {
      dataToSave = await blob.arrayBuffer();
    }
    await this.ocrResults.put({ imageId, _imageBlob: dataToSave });
  }

  async getImageBlob(imageId) {
    const record = await this.ocrResults.get(imageId);
    if (!record || !record._imageBlob) return undefined;
    const data = record._imageBlob;
    if (data instanceof ArrayBuffer || (data && typeof data === 'object' && 'byteLength' in data)) {
      return new Blob([data], { type: 'image/png' });
    }
    return data;
  }

  async updateImage(id, updates) {
    return await this.images.update(id, { ...updates, updatedAt: new Date() });
  }

  async getImage(id) {
    return await this.images.get(id);
  }

  async getAllImages() {
    return await this.images.orderBy('order').toArray();
  }

  async deleteImage(id) {
    await this.transaction('rw', [this.images, this.ocrResults], async () => {
      await this.images.delete(id);
      await this.ocrResults.delete(id);
    });
  }

  async deleteAllImages() {
    await this.transaction('rw', [this.images, this.ocrResults], async () => {
      await this.images.clear();
      await this.ocrResults.clear();
    });
  }

  // ── OCR Results ──

  async saveOcrResult(imageId, result) {
    const existing = await this.ocrResults.get(imageId);
    await this.ocrResults.put({
      imageId,
      text: result.text || '',
      rawText: result.rawText || '',
      status: result.status || 'done',
      createdAt: result.createdAt || new Date(),
      // Preserve image blob if it was already stored
      _imageBlob: existing?._imageBlob,
    });
  }

  async getOcrResult(imageId) {
    const record = await this.ocrResults.get(imageId);
    if (!record) return undefined;
    return { text: record.text, rawText: record.rawText, status: record.status };
  }

  // ── Settings ──

  async saveSetting(key, value) {
    await this.settings.put({ key, value });
  }

  async getSetting(key) {
    const record = await this.settings.get(key);
    return record?.value;
  }

  // ── Order Counter ──

  async getNextOrder() {
    const count = await this.images.count();
    return count;
  }
}

export const db = new OcrDatabase();
export { generateId };
