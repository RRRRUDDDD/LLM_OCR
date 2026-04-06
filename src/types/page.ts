export type PageStatus = 'idle' | 'queued' | 'processing' | 'done' | 'error';

export interface Page {
  id: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  status: PageStatus;
  ocrText: string;
  imageUrl: string;
  thumbnailUrl?: string;
  order?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoredPage extends Omit<Page, 'imageUrl'> {
  imageUrl?: string;
}

export interface OcrResultRecord {
  imageId: string;
  text: string;
  rawText: string;
  status: PageStatus;
  createdAt: Date;
}

export interface ImageBlobRecord {
  imageId: string;
  data: Blob | ArrayBuffer;
  mimeType?: string;
}

export interface SettingRecord {
  key: string;
  value: unknown;
}
