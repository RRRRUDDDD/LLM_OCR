import { db, generateId } from '../db/index';
import { cropImageRegion, isValidBBox } from '../utils/cropImage';
import { ocrLogger } from '../utils/logger';
import type { BBox, FigureRecord } from '../types/page';

/** Marker emitted by the book-mode OCR prompt: ![caption](figure://bbox?x1=..&y1=..&x2=..&y2=..) */
const FIGURE_MARKER_RE = /!\[([^\]]*)\]\(\s*figure:\/\/bbox\?([^)\s]*)\s*\)/g;

export const FIGURE_URL_PROTOCOL = 'figure://';

export function isFigureUrl(url: string): boolean {
  return url.startsWith(FIGURE_URL_PROTOCOL);
}

function parseBBoxQuery(query: string): BBox | null {
  const params = new URLSearchParams(query);
  const bbox: BBox = {
    x1: Number(params.get('x1')),
    y1: Number(params.get('y1')),
    x2: Number(params.get('x2')),
    y2: Number(params.get('y2')),
  };
  return isValidBBox(bbox) ? bbox : null;
}

/**
 * Parse figure markers in an OCR result, crop the referenced regions out of the
 * page image, persist them to the figures table, and rewrite each marker to a
 * stable `figure://{figureId}` reference.
 *
 * Degrades gracefully: markers with invalid bboxes or failed crops are replaced
 * by their caption text (the text survives even when the figure is lost).
 * Never throws — on unexpected failure the original text is returned untouched.
 */
export async function processFigureMarkers(pageId: string, text: string): Promise<string> {
  if (!text.includes(FIGURE_URL_PROTOCOL)) return text;

  try {
    const matches = Array.from(text.matchAll(FIGURE_MARKER_RE));
    if (matches.length === 0) return text;

    const pageBlob = await db.getImageBlob(pageId);
    const figures: Array<Omit<FigureRecord, 'data'> & { blob: Blob }> = [];
    const replacements: Array<{ start: number; end: number; replacement: string }> = [];

    for (const match of matches) {
      const [marker, caption, query] = match;
      const start = match.index;
      const end = start + marker.length;
      const bbox = pageBlob ? parseBBoxQuery(query) : null;

      let replacement = caption.trim();
      if (bbox && pageBlob) {
        try {
          const blob = await cropImageRegion(pageBlob, bbox);
          const figureId = generateId('fig');
          figures.push({
            id: figureId,
            pageId,
            bbox,
            caption: caption.trim(),
            mimeType: blob.type || 'image/jpeg',
            createdAt: new Date(),
            blob,
          });
          replacement = `![${caption.trim()}](${FIGURE_URL_PROTOCOL}${figureId})`;
        } catch (error) {
          ocrLogger.warn(`[figure] Crop failed on page ${pageId}:`, error);
        }
      }
      replacements.push({ start, end, replacement });
    }

    // Re-OCR replaces this page's figures wholesale, so stale crops never leak.
    await db.replaceFiguresForPage(pageId, figures);

    let result = '';
    let cursor = 0;
    for (const { start, end, replacement } of replacements) {
      result += text.slice(cursor, start) + replacement;
      cursor = end;
    }
    result += text.slice(cursor);
    return result;
  } catch (error) {
    ocrLogger.warn(`[figure] Marker processing failed on page ${pageId}:`, error);
    return text;
  }
}
