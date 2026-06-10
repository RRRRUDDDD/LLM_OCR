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
  /** Original source file name (e.g. "book.pdf") for multi-page sources. */
  sourceFile?: string;
  /** 1-based page number within the source file. */
  pageNumber?: number;
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

/** Normalized bounding box in permille (0-1000) of the page width/height. */
export interface BBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface FigureRecord {
  id: string;
  pageId: string;
  bbox: BBox;
  caption: string;
  data: Blob | ArrayBuffer;
  mimeType: string;
  createdAt: Date;
}
