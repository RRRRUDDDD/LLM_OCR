/**
 * Compress an image file via Canvas before base64 encoding.
 * Only compresses when the image exceeds the size threshold.
 *
 * @param {File} file          - Source image file
 * @param {object} [opts]
 * @param {number} [opts.maxDim=2048]       - Max width/height (px)
 * @param {number} [opts.quality=0.85]      - JPEG quality (0-1)
 * @param {number} [opts.threshold=1048576] - Skip compression below this size (bytes, default 1 MB)
 * @returns {Promise<{ base64: string, mimeType: string }>}
 */
export default function compressImage(file, opts = {}) {
  const { maxDim = 2048, quality = 0.85, threshold = 1_048_576 } = opts;

  return new Promise((resolve, reject) => {
    // Small files — skip compression, read directly
    if (file.size <= threshold) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result;
        const commaIdx = dataUrl.indexOf(',');
        resolve({ base64: dataUrl.slice(commaIdx + 1), mimeType: file.type });
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
      return;
    }

    // Large files — compress via Canvas
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      let { width, height } = img;

      // Scale down if exceeds maxDim
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      // Prefer WebP (25-35% smaller than JPEG); fall back to JPEG; keep PNG for transparency
      let outputType;
      if (file.type === 'image/png') {
        outputType = 'image/png';
      } else {
        const webpProbe = canvas.toDataURL('image/webp', 0.5);
        outputType = webpProbe.startsWith('data:image/webp') ? 'image/webp' : 'image/jpeg';
      }
      const effectiveQuality = outputType === 'image/png' ? undefined : quality;

      const dataUrl = canvas.toDataURL(outputType, effectiveQuality);
      const commaIdx = dataUrl.indexOf(',');

      // Release pixel buffer immediately (~width*height*4 bytes)
      canvas.width = canvas.height = 0;

      resolve({ base64: dataUrl.slice(commaIdx + 1), mimeType: outputType });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image for compression'));
    };

    img.src = url;
  });
}
