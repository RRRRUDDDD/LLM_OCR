import { canvasToBlob, createCanvas, decodeImage, get2DContext } from './canvas';
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

    const canvas = createCanvas(cropWidth, cropHeight);
    const ctx = get2DContext(canvas);

    ctx.drawImage(image, left, top, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
    return await canvasToBlob(canvas, FIGURE_IMAGE_TYPE, FIGURE_IMAGE_QUALITY);
  } finally {
    close();
  }
}
