let _webpSupported = null;

function detectWebPSupport() {
  if (_webpSupported !== null) return _webpSupported;
  try {
    // OffscreenCanvas 可构造则支持，toDataURL 在 Worker 不可用故默认 JPEG
    new OffscreenCanvas(1, 1);
    _webpSupported = false;
  } catch {
    _webpSupported = false;
  }
  return _webpSupported;
}

async function compress(file, opts = {}) {
  const { maxDim = 2048, quality = 0.85, threshold = 1_048_576 } = opts;

  const bitmap = await createImageBitmap(file);
  const { width: origW, height: origH } = bitmap;

  const needsResize = origW > maxDim || origH > maxDim;
  const needsCompress = file.size > threshold;

  if (!needsResize && !needsCompress) {
    bitmap.close();
    // 直接读取原始文件
    const ab = await file.arrayBuffer();
    const base64 = arrayBufferToBase64(ab);
    return { base64, mimeType: file.type };
  }

  let width = origW;
  let height = origH;

  if (needsResize) {
    const scale = maxDim / Math.max(origW, origH);
    width = Math.round(origW * scale);
    height = Math.round(origH * scale);
  }

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  // Worker 中无法可靠探测 WebP，PNG 保留透明通道，其余用 JPEG
  const outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const effectiveQuality = outputType === 'image/png' ? undefined : quality;

  const blob = await canvas.convertToBlob({ type: outputType, quality: effectiveQuality });

  const ab = await blob.arrayBuffer();
  const base64 = arrayBufferToBase64(ab);
  return { base64, mimeType: outputType };
}

/** ArrayBuffer → base64 字符串（Worker 中无 FileReader，用分块转换） */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

self.onmessage = async (e) => {
  const { id, file, opts } = e.data;
  try {
    const result = await compress(file, opts);
    self.postMessage({ id, ...result });
  } catch (err) {
    self.postMessage({ id, error: err.message });
  }
};
