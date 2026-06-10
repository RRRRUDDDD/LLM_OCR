let webpSupported: boolean | null = null;

/** Detect (and cache) whether the browser can encode canvas content as WebP. */
export default function detectWebPSupport(): boolean {
  if (webpSupported !== null) return webpSupported;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  webpSupported = canvas.toDataURL('image/webp', 0.5).startsWith('data:image/webp');
  return webpSupported;
}
