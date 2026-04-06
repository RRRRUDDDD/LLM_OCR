/// <reference lib="webworker" />

import type { CompressOptions, CompressResult, WorkerCompressRequest } from '../types/compress';

declare const self: DedicatedWorkerGlobalScope;

async function createCompressedBlob(canvas: OffscreenCanvas, quality: number): Promise<{ blob: Blob; mimeType: string }> {
  for (const mimeType of ['image/webp', 'image/jpeg']) {
    const blob = await canvas.convertToBlob({ type: mimeType, quality });
    if (blob.type === mimeType) {
      return { blob, mimeType };
    }
  }

  const fallbackBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  return { blob: fallbackBlob, mimeType: fallbackBlob.type || 'image/jpeg' };
}

async function compress(file: File, opts: CompressOptions = {}): Promise<CompressResult> {
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
  if (!ctx) {
    bitmap.close();
    throw new Error('2D canvas context is unavailable');
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const { blob, mimeType } = await createCompressedBlob(canvas, quality);

  const ab = await blob.arrayBuffer();
  const base64 = arrayBufferToBase64(ab);
  return { base64, mimeType };
}

/** ArrayBuffer → base64 字符串（Worker 中无 FileReader，用分块转换） */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

self.onmessage = async (e: MessageEvent<WorkerCompressRequest>) => {
  const { id, file, opts } = e.data;
  try {
    const result = await compress(file, opts);
    self.postMessage({ id, ...result });
  } catch (err: unknown) {
    self.postMessage({
      id,
      error: err instanceof Error ? err.message : 'Unknown worker error',
    });
  }
};

export {};
