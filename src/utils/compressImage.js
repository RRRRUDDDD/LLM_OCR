/**
 * 通过 Canvas 在 base64 编码前压缩图片文件。
 * 仅在图片超过阈值时执行压缩。
 *
 * P2-2：使用 canvas.toBlob（异步）替代 canvas.toDataURL（同步），
 * 避免大图阻塞主线程。
 * P3-1：WebP 支持探测仅执行一次，结果在 session 生命周期内缓存。
 *
 * @param {File} file          - 源图片文件
 * @param {object} [opts]
 * @param {number} [opts.maxDim=2048]       - 最大宽/高（像素）
 * @param {number} [opts.quality=0.85]      - JPEG 质量（0-1）
 * @param {number} [opts.threshold=1048576] - 低于此大小跳过压缩（字节，默认 1 MB）
 * @returns {Promise<{ base64: string, mimeType: string }>}
 */

/** 缓存的 WebP 支持探测结果——null 表示未检测，true/false 为结果 */
let _webpSupported = null;

/** 返回浏览器是否支持通过 Canvas 编码 WebP */
function detectWebPSupport() {
  if (_webpSupported !== null) return _webpSupported;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  _webpSupported = canvas.toDataURL('image/webp', 0.5).startsWith('data:image/webp');
  return _webpSupported;
}

export default function compressImage(file, opts = {}) {
  const { maxDim = 2048, quality = 0.85, threshold = 1_048_576 } = opts;

  return new Promise((resolve, reject) => {
    // 小文件——跳过压缩，直接读取
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

    // 大文件——通过 Canvas 压缩
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      let { width, height } = img;

      // 超过 maxDim 时按比例缩小
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

      // 优先 WebP（比 JPEG 小 25-35%）；回退到 JPEG；PNG 保留透明通道
      let outputType;
      if (file.type === 'image/png') {
        outputType = 'image/png';
      } else {
        // P3-1：使用缓存探测结果，避免每次调用都执行 toDataURL 探测
        outputType = detectWebPSupport() ? 'image/webp' : 'image/jpeg';
      }
      const effectiveQuality = outputType === 'image/png' ? undefined : quality;

      // P2-2：使用 toBlob（异步）替代 toDataURL（同步），避免阻塞主线程
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            // 释放像素缓冲区
            canvas.width = canvas.height = 0;
            reject(new Error('Failed to compress image'));
            return;
          }
          const reader = new FileReader();
          reader.onloadend = () => {
            const dataUrl = reader.result;
            const commaIdx = dataUrl.indexOf(',');
            // 立即释放像素缓冲区（约 width*height*4 字节）
            canvas.width = canvas.height = 0;
            resolve({ base64: dataUrl.slice(commaIdx + 1), mimeType: outputType });
          };
          reader.onerror = () => {
            canvas.width = canvas.height = 0;
            reject(new Error('Failed to read compressed blob'));
          };
          reader.readAsDataURL(blob);
        },
        outputType,
        effectiveQuality,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image for compression'));
    };

    img.src = url;
  });
}
