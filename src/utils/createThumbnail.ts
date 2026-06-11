import detectWebPSupport from './webpSupport';
import { decodeImage } from './canvas';

const DEFAULT_THUMBNAIL_SIZE = 160;
const DEFAULT_QUALITY = 0.8;

export default async function createThumbnail(
  source: Blob,
  maxSize = DEFAULT_THUMBNAIL_SIZE,
  quality = DEFAULT_QUALITY,
): Promise<string> {
  const { image, width: sourceWidth, height: sourceHeight, close } = await decodeImage(source);

  try {
    const scale = Math.min(1, maxSize / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));

    // DOM canvas on purpose: the thumbnail is persisted as a data URL and
    // OffscreenCanvas has no toDataURL.
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('2D canvas context is unavailable');
    }

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);

    return canvas.toDataURL(detectWebPSupport() ? 'image/webp' : 'image/jpeg', quality);
  } finally {
    close();
  }
}
