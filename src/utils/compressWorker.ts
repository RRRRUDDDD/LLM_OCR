/// <reference lib="webworker" />

import { encodeCanvas } from './canvas';
import type { CompressOptions, CompressResult, WorkerCompressRequest } from '../types/compress';

declare const self: DedicatedWorkerGlobalScope;

/** Blob → base64 via FileReaderSync (worker-only API, no chunked string building). */
function blobToBase64(blob: Blob): string {
  const dataUrl = new FileReaderSync().readAsDataURL(blob);
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
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
    return { base64: blobToBase64(file), mimeType: file.type };
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

  const { blob, mimeType } = await encodeCanvas(canvas, ['image/webp', 'image/jpeg'], quality);
  return { base64: blobToBase64(blob), mimeType };
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
