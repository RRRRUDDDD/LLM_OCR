import * as pdfjsLib from 'pdfjs-dist';
import { ocrEvents } from '../events/ocrEvents';
import { generateId } from '../db/index';
import { ocrLogger } from '../utils/logger';

interface RenderablePdfPage {
  getViewport: (params: { scale: number }) => { width: number; height: number };
  render: (params: { canvasContext: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D; viewport: { width: number; height: number } }) => { promise: Promise<void> };
  cleanup?: () => void;
}

interface RenderablePdfDocument {
  numPages: number;
  getPage: (pageNumber: number) => Promise<RenderablePdfPage>;
  cleanup?: () => void | Promise<void>;
  destroy?: () => void | Promise<void>;
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
  /** 1-based page numbers to extract; omit to extract every page. */
  pageNumbers?: number[];
  onPage?: (page: ExtractedPdfPage) => void | Promise<void>;
}

export interface ExtractPdfSummary {
  pageIds: string[];
  totalPages: number;
}

export interface RenderedPdfPage {
  blob: Blob;
  width: number;
  height: number;
}

/**
 * A handle over a loaded PDF document that renders individual pages on
 * demand at any target width (thumbnails and large previews share it, so
 * the file is parsed only once per dialog). Renders are serialized through
 * an internal promise chain — pdf.js page objects must not be rendered and
 * cleaned up concurrently.
 */
export interface PdfRenderSource {
  totalPages: number;
  renderPage: (pageNumber: number, targetWidth: number) => Promise<RenderedPdfPage>;
  destroy: () => Promise<void>;
}

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

const DEFAULT_SCALE = 2.0; // 144 DPI (2x of 72 DPI base)
// JPEG instead of PNG: pdf.js renders on a white background by default, and
// JPEG cuts IndexedDB storage to a fraction with no practical OCR impact.
const PAGE_IMAGE_TYPE = 'image/jpeg';
const PAGE_IMAGE_QUALITY = 0.92;

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

  const blob = await canvas.convertToBlob({ type: PAGE_IMAGE_TYPE, quality: PAGE_IMAGE_QUALITY });
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
      PAGE_IMAGE_TYPE,
      PAGE_IMAGE_QUALITY
    );
  });
}

async function loadPdfDocument(file: File, signal?: AbortSignal): Promise<RenderablePdfDocument | null> {
  const arrayBuffer = await file.arrayBuffer();
  if (signal?.aborted) return null;
  return await pdfjsLib.getDocument({ data: arrayBuffer }).promise as unknown as RenderablePdfDocument;
}

export async function extractPdfPages(file: File, options: ExtractPdfOptions = {}): Promise<ExtractPdfSummary> {
  const { scale = DEFAULT_SCALE, signal, pageNumbers, onPage } = options;
  const fileName = file.name;
  let pdf: RenderablePdfDocument | null = null;

  try {
    pdf = await loadPdfDocument(file, signal);
    if (!pdf) return { pageIds: [], totalPages: 0 };
    const totalPages = pdf.numPages;

    const targets = pageNumbers
      ? Array.from(new Set(pageNumbers)).filter((n) => n >= 1 && n <= totalPages).sort((a, b) => a - b)
      : Array.from({ length: totalPages }, (_, i) => i + 1);

    ocrEvents.emit('pdf:start', { fileName, totalPages: targets.length });
    ocrLogger.info(`[PDF] Processing "${fileName}": ${targets.length}/${totalPages} pages`);

    const supportsOffscreen = typeof OffscreenCanvas !== 'undefined';
    const renderFn = supportsOffscreen ? renderPageToBlob : renderPageToBlobFallback;

    const pageIds: string[] = [];

    for (let i = 0; i < targets.length; i++) {
      if (signal?.aborted) break;
      const pageNumber = targets[i];

      const page = await pdf.getPage(pageNumber) as unknown as RenderablePdfPage;
      try {
        const { blob, width, height } = await renderFn(page, scale);
        const pageId = generateId('pdf');
        const extractedPage: ExtractedPdfPage = {
          id: pageId,
          blob,
          width,
          height,
          pageNumber,
          fileName: `${fileName} - Page ${pageNumber}`,
        };

        pageIds.push(pageId);
        await onPage?.(extractedPage);

        ocrEvents.emit('pdf:page:done', {
          pageIndex: pageNumber - 1,
          pageId,
          blob,
          width,
          height,
        });
        ocrEvents.emit('pdf:progress', { done: i + 1, total: targets.length, fileName });
      } finally {
        page.cleanup?.();
      }
    }

    ocrEvents.emit('pdf:complete', {
      fileName,
      totalPages: targets.length,
      pageIds,
    });

    ocrLogger.info(`[PDF] Completed "${fileName}": ${pageIds.length} pages extracted`);
    return { pageIds, totalPages };
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') return { pageIds: [], totalPages: 0 };
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    ocrLogger.error(`[PDF] Failed to process "${fileName}":`, normalizedError);
    ocrEvents.emit('pdf:error', { fileName, error: normalizedError });
    throw normalizedError;
  } finally {
    await pdf?.cleanup?.();
    await pdf?.destroy?.();
  }
}

/**
 * Open a PDF as an on-demand page render source for the selection dialog.
 * Callers own the lifecycle and must call destroy().
 */
export async function createPdfRenderSource(file: File): Promise<PdfRenderSource> {
  const pdf = await loadPdfDocument(file);
  if (!pdf) throw new Error('PDF document failed to load');

  const supportsOffscreen = typeof OffscreenCanvas !== 'undefined';
  const renderFn = supportsOffscreen ? renderPageToBlob : renderPageToBlobFallback;

  let chain: Promise<unknown> = Promise.resolve();

  const renderPage = (pageNumber: number, targetWidth: number): Promise<RenderedPdfPage> => {
    const task = chain.then(async () => {
      const page = await pdf.getPage(pageNumber) as unknown as RenderablePdfPage;
      try {
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = targetWidth / Math.max(1, baseViewport.width);
        return await renderFn(page, scale);
      } finally {
        page.cleanup?.();
      }
    });
    chain = task.catch(() => undefined);
    return task;
  };

  return {
    totalPages: pdf.numPages,
    renderPage,
    destroy: async () => {
      await chain.catch(() => undefined);
      await pdf.cleanup?.();
      await pdf.destroy?.();
    },
  };
}
