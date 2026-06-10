import detectWebPSupport from './webpSupport';

const DEFAULT_THUMBNAIL_SIZE = 160;
const DEFAULT_QUALITY = 0.8;

export default async function createThumbnail(
  source: Blob,
  maxSize = DEFAULT_THUMBNAIL_SIZE,
  quality = DEFAULT_QUALITY,
): Promise<string> {
  const url = URL.createObjectURL(source);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load image for thumbnail generation'));
      img.src = url;
    });

    const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));

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
    URL.revokeObjectURL(url);
  }
}
