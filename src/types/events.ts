import type { QueueStats } from './queue';

export type HealthStatus = 'healthy' | 'degraded' | 'unavailable';

export interface PdfPageDoneEvent {
  pageIndex: number;
  pageId: string;
  blob: Blob;
  width: number;
  height: number;
}

export interface PdfProgressEvent {
  done: number;
  total: number;
  fileName: string;
}

export interface PdfStartEvent {
  fileName: string;
  totalPages: number;
}

export interface PdfCompleteEvent {
  fileName: string;
  totalPages: number;
  pageIds: string[];
}

export type OcrEventMap = Record<string, unknown> & {
  'ocr:queued': { imageId: string };
  'ocr:start': { imageId: string };
  'ocr:progress': { imageId: string; text: string };
  'ocr:success': { imageId: string; text: string };
  'ocr:error': { imageId: string; error: Error };
  'ocr:cancelled': { imageId: string };
  'health:changed': { status: HealthStatus; prevStatus: HealthStatus };
  'queue:stats': QueueStats;
  'pdf:start': PdfStartEvent;
  'pdf:page:done': PdfPageDoneEvent;
  'pdf:progress': PdfProgressEvent;
  'pdf:complete': PdfCompleteEvent;
  'pdf:error': { fileName: string; error: Error };
};
