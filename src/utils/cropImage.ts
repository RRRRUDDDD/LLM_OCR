import type { BBox } from '../types/page';

const FIGURE_IMAGE_TYPE = 'image/jpeg';
const FIGURE_IMAGE_QUALITY = 0.92;
// Expand the crop slightly — VLM bboxes tend to clip figure edges.
const BBOX_PADDING_RATIO = 0.02;
// Reject boxes covering less than 1% of the page (decorations, hallucinated dots).
const MIN_AREA_PERMILLE = 10_000;
const PERMILLE = 1000;

export function isValidBBox(bbox: BBox): boolean {
  const { x1, y1, x2, y2 } = bbox;
  if (![x1, y1, x2, y2].every((v) => Number.isFinite(v))) return false;
  if (x1 < 0 || y1 < 0 || x2 > PERMILLE || y2 > PERMILLE) return false;
  if (x2 <= x1 || y2 <= y1) return false;
  return (x2 - x1) * (y2 - y1) >= MIN_AREA_PERMILLE;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

async function decodeImage(source: Blob): Promise<{ image: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(source);
    return { image: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  }

  const url = URL.createObjectURL(source);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Failed to decode image for cropping'));
      img.src = url;
    });
    return { image: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

async function canvasToBlob(canvas: OffscreenCanvas | HTMLCanvasElement): Promise<Blob> {
  if (canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob({ type: FIGURE_IMAGE_TYPE, quality: FIGURE_IMAGE_QUALITY });
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Canvas toBlob returned null'))),
      FIGURE_IMAGE_TYPE,
      FIGURE_IMAGE_QUALITY
    );
  });
}

/**
 * Crop a region out of a page image. The bbox uses permille coordinates
 * (0-1000 relative to page width/height) as emitted by the OCR model.
 */
export async function cropImageRegion(source: Blob, bbox: BBox): Promise<Blob> {
  if (!isValidBBox(bbox)) {
    throw new Error(`Invalid bbox: ${JSON.stringify(bbox)}`);
  }

  const { image, width, height, close } = await decodeImage(source);
  try {
    const padX = width * BBOX_PADDING_RATIO;
    const padY = height * BBOX_PADDING_RATIO;
    const left = clamp((bbox.x1 / PERMILLE) * width - padX, 0, width);
    const top = clamp((bbox.y1 / PERMILLE) * height - padY, 0, height);
    const right = clamp((bbox.x2 / PERMILLE) * width + padX, 0, width);
    const bottom = clamp((bbox.y2 / PERMILLE) * height + padY, 0, height);

    const cropWidth = Math.max(1, Math.round(right - left));
    const cropHeight = Math.max(1, Math.round(bottom - top));

    const canvas = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(cropWidth, cropHeight)
      : (() => {
          const el = document.createElement('canvas');
          el.width = cropWidth;
          el.height = cropHeight;
          return el;
        })();

    const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
    if (!ctx) throw new Error('2D canvas context is unavailable');

    ctx.drawImage(image, left, top, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
    return await canvasToBlob(canvas);
  } finally {
    close();
  }
}
