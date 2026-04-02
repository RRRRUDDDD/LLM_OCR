import * as pdfjsLib from 'pdfjs-dist';
import { ocrEvents } from '../events/ocrEvents';
import { db, generateId } from '../db/index';
import { ocrLogger } from '../utils/logger';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

const DEFAULT_SCALE = 2.0; // 144 DPI (2x of 72 DPI base)

export function isPdf(file) {
  return (
    file.type === 'application/pdf' ||
    file.name.toLowerCase().endsWith('.pdf')
  );
}

async function renderPageToBlob(page, scale = DEFAULT_SCALE) {
  const viewport = page.getViewport({ scale });
  const canvas = new OffscreenCanvas(viewport.width, viewport.height);
  const ctx = canvas.getContext('2d');

  await page.render({ canvasContext: ctx, viewport }).promise;

  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return { blob, width: viewport.width, height: viewport.height };
}

async function renderPageToBlobFallback(page, scale = DEFAULT_SCALE) {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');

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

export async function extractPdfPages(file, options = {}) {
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

    const results = [];

    for (let i = 1; i <= totalPages; i++) {
      if (signal?.aborted) break;

      const page = await pdf.getPage(i);
      const { blob, width, height } = await renderFn(page, scale);

      const pageId = generateId('pdf');

      // Create a thumbnail (smaller version for the list)
      const thumbnailUrl = URL.createObjectURL(blob);

      results.push({ id: pageId, blob, width, height, thumbnailUrl });

      // Persist to IndexedDB
      await db.saveImage({
        id: pageId,
        fileName: `${fileName} - Page ${i}`,
        fileSize: blob.size,
        fileType: 'image/png',
        status: 'idle',
        thumbnailUrl: '',
        order: undefined, // auto-assign
        createdAt: new Date(),
      });
      await db.saveImageBlob(pageId, blob);

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
  } catch (error) {
    if (error.name === 'AbortError') return [];
    ocrLogger.error(`[PDF] Failed to process "${fileName}":`, error);
    ocrEvents.emit('pdf:error', { fileName, error });
    throw error;
  }
}
