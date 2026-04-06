import type { CompressOptions, CompressResult, WorkerCompressResponse } from '../types/compress';

function isWorkerSupported(): boolean {
  return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined';
}

let workerSupported: boolean | null = null;
let jobId = 0;

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
}

function compressViaWorker(file: File, opts?: CompressOptions, signal?: AbortSignal): Promise<CompressResult> | null {
  if (workerSupported === false || !isWorkerSupported()) {
    workerSupported = false;
    return null;
  }

  try {
    const worker = new Worker(new URL('./compressWorker.ts', import.meta.url), { type: 'module' });
    workerSupported = true;
    const id = jobId++;

    return new Promise<CompressResult>((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        worker.onmessage = null;
        worker.onerror = null;
        signal?.removeEventListener('abort', onAbort);
        worker.terminate();
      };

      const settle = (callback: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback();
      };

      const onAbort = () => {
        settle(() => reject(new DOMException('Aborted', 'AbortError')));
      };

      worker.onmessage = (e: MessageEvent<WorkerCompressResponse>) => {
        const { id: responseId, base64, mimeType, error } = e.data;
        if (responseId !== id) return;
        settle(() => {
          if (error) reject(new Error(error));
          else if (base64 && mimeType) resolve({ base64, mimeType });
          else reject(new Error('Worker returned an invalid payload'));
        });
      };

      worker.onerror = (e) => {
        workerSupported = false;
        settle(() => reject(new Error('Worker error: ' + e.message)));
      };

      throwIfAborted(signal);
      signal?.addEventListener('abort', onAbort, { once: true });
      worker.postMessage({ id, file, opts });
    });
  } catch {
    workerSupported = false;
    return null;
  }
}

let webpSupported: boolean | null = null;

function detectWebPSupport(): boolean {
  if (webpSupported !== null) return webpSupported;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  webpSupported = canvas.toDataURL('image/webp', 0.5).startsWith('data:image/webp');
  return webpSupported;
}

function getPreferredMimeTypes(): string[] {
  return detectWebPSupport() ? ['image/webp', 'image/jpeg'] : ['image/jpeg'];
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to compress image'));
      },
      type,
      quality,
    );
  });
}

async function createCompressedBlob(canvas: HTMLCanvasElement, quality: number): Promise<{ blob: Blob; mimeType: string }> {
  for (const mimeType of getPreferredMimeTypes()) {
    const blob = await canvasToBlob(canvas, mimeType, quality);
    if (blob.type === mimeType) {
      return { blob, mimeType };
    }
  }

  const fallbackBlob = await canvasToBlob(canvas, 'image/jpeg', quality);
  return { blob: fallbackBlob, mimeType: fallbackBlob.type || 'image/jpeg' };
}

function compressOnMainThread(file: File, opts: CompressOptions = {}, signal?: AbortSignal): Promise<CompressResult> {
  const { maxDim = 2048, quality = 0.85, threshold = 1_048_576 } = opts;

  return new Promise((resolve, reject) => {
    throwIfAborted(signal);
    const img = new Image();
    const url = URL.createObjectURL(file);
    let settled = false;

    const cleanupAbort = () => signal?.removeEventListener('abort', onAbort);
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanupAbort();
      callback();
    };

    const onAbort = () => {
      finish(() => {
        URL.revokeObjectURL(url);
        img.src = '';
        reject(new DOMException('Aborted', 'AbortError'));
      });
    };

    signal?.addEventListener('abort', onAbort, { once: true });

    img.onload = () => {
      if (settled) return;
      URL.revokeObjectURL(url);
      throwIfAborted(signal);

      const needsResize = img.naturalWidth > maxDim || img.naturalHeight > maxDim;
      const needsCompress = file.size > threshold;

      if (!needsResize && !needsCompress) {
        const reader = new FileReader();
        reader.onloadend = () => {
          if (settled) return;
          const dataUrl = reader.result;
          if (typeof dataUrl !== 'string') {
            finish(() => reject(new Error('Failed to read file as data URL')));
            return;
          }
          const commaIdx = dataUrl.indexOf(',');
          finish(() => resolve({ base64: dataUrl.slice(commaIdx + 1), mimeType: file.type }));
        };
        reader.onerror = () => finish(() => reject(new Error('Failed to read file')));
        reader.readAsDataURL(file);
        return;
      }

      let { naturalWidth: width, naturalHeight: height } = img;

      if (needsResize) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        finish(() => reject(new Error('2D canvas context is unavailable')));
        return;
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      void createCompressedBlob(canvas, quality)
        .then(({ blob, mimeType }) => {
          if (settled) return;
          const reader = new FileReader();
          reader.onloadend = () => {
            if (settled) return;
            const dataUrl = reader.result;
            if (typeof dataUrl !== 'string') {
              canvas.width = canvas.height = 0;
              finish(() => reject(new Error('Failed to read compressed blob')));
              return;
            }
            const commaIdx = dataUrl.indexOf(',');
            canvas.width = canvas.height = 0;
            finish(() => resolve({ base64: dataUrl.slice(commaIdx + 1), mimeType }));
          };
          reader.onerror = () => {
            canvas.width = canvas.height = 0;
            finish(() => reject(new Error('Failed to read compressed blob')));
          };
          reader.readAsDataURL(blob);
        })
        .catch((error: unknown) => {
          canvas.width = canvas.height = 0;
          finish(() => reject(error instanceof Error ? error : new Error('Failed to compress image')));
        });
    };

    img.onerror = () => {
      finish(() => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load image for compression'));
      });
    };

    img.src = url;
  });
}

// Hoist EXIF fix import to module level (cached after first load)
let fixExifOrientationFn: ((blob: Blob | File, signal?: AbortSignal) => Promise<Blob | File>) | null = null;
const exifFixPromise = import('./exifFix').then((m) => {
  fixExifOrientationFn = m.fixExifOrientation;
}).catch(() => {
  // EXIF module unavailable, proceed without
});

export default async function compressImage(file: File, opts: CompressOptions = {}, signal?: AbortSignal): Promise<CompressResult> {
  // Fix EXIF orientation before compression (mobile photos may be rotated)
  throwIfAborted(signal);
  let inputFile = file;
  await exifFixPromise; // Ensure module is loaded (no-op after first call)
  if (fixExifOrientationFn) {
    try {
      const fixed = await fixExifOrientationFn(file, signal);
      if (fixed !== file) {
        inputFile = new File([fixed], file.name || 'image.jpg', { type: fixed.type || file.type });
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      // EXIF fix failed (e.g. non-JPEG), proceed with original
    }
  }

  throwIfAborted(signal);
  const workerResult = compressViaWorker(inputFile, opts, signal);
  if (workerResult) {
    try {
      return await workerResult;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      return compressOnMainThread(inputFile, opts, signal);
    }
  }
  return compressOnMainThread(inputFile, opts, signal);
}
