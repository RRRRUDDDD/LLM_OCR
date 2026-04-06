import * as pdfjsLib from 'pdfjs-dist';
import { ocrEvents } from '../events/ocrEvents';
import { generateId } from '../db/index';
import { ocrLogger } from '../utils/logger';

interface RenderablePdfPage {
  getViewport: (params: { scale: number }) => { width: number; height: number };
  render: (params: { canvasContext: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D; viewport: { width: number; height: number } }) => { promise: Promise<void> };
}

export interface ExtractedPdfPage {
  id: string;
  blob: Blob;
  width: number;
  height: number;
  pageNumber: number;
  fileName: string;
}

export interface ExtractPdfOptions {
  scale?: number;
  signal?: AbortSignal;
}

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

const DEFAULT_SCALE = 2.0; // 144 DPI (2x of 72 DPI base)

export function isPdf(file: File): boolean {
  return (
    file.type === 'application/pdf' ||
    file.name.toLowerCase().endsWith('.pdf')
  );
}

async function renderPageToBlob(page: RenderablePdfPage, scale = DEFAULT_SCALE): Promise<{ blob: Blob; width: number; height: number }> {
  const viewport = page.getViewport({ scale });
  const canvas = new OffscreenCanvas(viewport.width, viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context is unavailable');

  await page.render({ canvasContext: ctx, viewport }).promise;

  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return { blob, width: viewport.width, height: viewport.height };
}

async function renderPageToBlobFallback(page: RenderablePdfPage, scale = DEFAULT_SCALE): Promise<{ blob: Blob; width: number; height: number }> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context is unavailable');

  await page.render({ canvasContext: ctx, viewport }).promise;

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve({ blob, width: viewport.width, height: viewport.height });
        else reject(new Error('Canvas toBlob returned null'));
      },
      'image/png'
    );
  });
}

export async function extractPdfPages(file: File, options: ExtractPdfOptions = {}): Promise<ExtractedPdfPage[]> {
  const { scale = DEFAULT_SCALE, signal } = options;
  const fileName = file.name;

  try {
    const arrayBuffer = await file.arrayBuffer();
    if (signal?.aborted) return [];

    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const totalPages = pdf.numPages;

    ocrEvents.emit('pdf:start', { fileName, totalPages });
    ocrLogger.info(`[PDF] Processing "${fileName}": ${totalPages} pages`);

    const supportsOffscreen = typeof OffscreenCanvas !== 'undefined';
    const renderFn = supportsOffscreen ? renderPageToBlob : renderPageToBlobFallback;

    const results: ExtractedPdfPage[] = [];

    for (let i = 1; i <= totalPages; i++) {
      if (signal?.aborted) break;

      const page = await pdf.getPage(i) as unknown as RenderablePdfPage;
      const { blob, width, height } = await renderFn(page, scale);

      const pageId = generateId('pdf');

      results.push({ id: pageId, blob, width, height, pageNumber: i, fileName: `${fileName} - Page ${i}` });

      ocrEvents.emit('pdf:page:done', {
        pageIndex: i - 1,
        pageId,
        blob,
        width,
        height,
      });
      ocrEvents.emit('pdf:progress', { done: i, total: totalPages, fileName });
    }

    ocrEvents.emit('pdf:complete', {
      fileName,
      totalPages,
      pageIds: results.map((r) => r.id),
    });

    ocrLogger.info(`[PDF] Completed "${fileName}": ${results.length} pages extracted`);
    return results;
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') return [];
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    ocrLogger.error(`[PDF] Failed to process "${fileName}":`, normalizedError);
    ocrEvents.emit('pdf:error', { fileName, error: normalizedError });
    throw normalizedError;
  }
}
