/**
 * Shared canvas helpers (deduplicated from compressImage / compressWorker /
 * cropImage / pdfService). Work in both window and worker contexts —
 * OffscreenCanvas is preferred, DOM canvas is the fallback.
 */

export type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
export type AnyCanvas2DContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

export interface DecodedImage {
  image: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

export function createCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function get2DContext(canvas: AnyCanvas): AnyCanvas2DContext {
  const ctx = canvas.getContext('2d') as AnyCanvas2DContext | null;
  if (!ctx) throw new Error('2D canvas context is unavailable');
  return ctx;
}

export function canvasToBlob(canvas: AnyCanvas, type: string, quality?: number): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob({ type, quality });
  }
  return new Promise((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Canvas toBlob returned null'))),
      type,
      quality,
    );
  });
}

/**
 * Encode a canvas trying each MIME type in order; browsers silently fall back
 * to PNG when a type is unsupported, so the result type is verified.
 */
export async function encodeCanvas(canvas: AnyCanvas, mimeTypes: string[], quality: number): Promise<{ blob: Blob; mimeType: string }> {
  for (const mimeType of mimeTypes) {
    const blob = await canvasToBlob(canvas, mimeType, quality);
    if (blob.type === mimeType) {
      return { blob, mimeType };
    }
  }

  const fallbackBlob = await canvasToBlob(canvas, 'image/jpeg', quality);
  return { blob: fallbackBlob, mimeType: fallbackBlob.type || 'image/jpeg' };
}

/** Decode a blob to a drawable image, preferring createImageBitmap. */
export async function decodeImage(source: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(source);
    return { image: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  }

  const url = URL.createObjectURL(source);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Failed to decode image'));
      img.src = url;
    });
    return { image: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}
