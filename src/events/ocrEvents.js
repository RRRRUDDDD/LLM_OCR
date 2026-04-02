import mitt from 'mitt';

/**
 * OCR Event Bus
 *
 * Lifecycle events:
 *   ocr:queued    { imageId }
 *   ocr:start     { imageId }
 *   ocr:progress  { imageId, text }       (streaming chunks)
 *   ocr:success   { imageId, text }
 *   ocr:error     { imageId, error }
 *   ocr:cancelled { imageId }
 *
 * Health events:
 *   health:changed { status, prevStatus }  (healthy | degraded | unavailable)
 *
 * Queue events:
 *   queue:stats   { active, pending, total }
 */
export const ocrEvents = mitt();
