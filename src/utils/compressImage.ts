import type { CompressOptions, CompressResult, WorkerCompressResponse } from '../types/compress';

function isWorkerSupported(): boolean {
  return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined';
}

let workerSupported: boolean | null = null;
let jobId = 0;

interface PendingWorkerJob {
  id: number;
  file: File;
  opts?: CompressOptions;
  signal?: AbortSignal;
  resolve: (result: CompressResult) => void;
  reject: (error: Error) => void;
}

interface WorkerSlot {
  worker: Worker;
  currentJob: PendingWorkerJob | null;
  abortHandler: (() => void) | null;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
}

class CompressionWorkerPool {
  private readonly slots: WorkerSlot[] = [];
  private readonly pendingJobs: PendingWorkerJob[] = [];
  private readonly maxWorkers: number;

  constructor() {
    const hardwareConcurrency = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2;
    this.maxWorkers = Math.max(1, Math.min(3, hardwareConcurrency));
  }

  private createWorker(): Worker {
    return new Worker(new URL('./compressWorker.ts', import.meta.url), { type: 'module' });
  }

  private detachAbortHandler(slot: WorkerSlot): void {
    if (slot.currentJob && slot.abortHandler) {
      slot.currentJob.signal?.removeEventListener('abort', slot.abortHandler);
    }
    slot.abortHandler = null;
  }

  private attachWorkerEvents(slot: WorkerSlot): void {
    slot.worker.onmessage = (event: MessageEvent<WorkerCompressResponse>) => {
      const job = slot.currentJob;
      if (!job || event.data.id !== job.id) return;

      slot.currentJob = null;
      this.detachAbortHandler(slot);

      const { base64, mimeType, error } = event.data;
      if (error) {
        job.reject(new Error(error));
      } else if (base64 && mimeType) {
        job.resolve({ base64, mimeType });
      } else {
        job.reject(new Error('Worker returned an invalid payload'));
      }

      this.dispatchPendingJobs();
    };

    slot.worker.onerror = (event: ErrorEvent) => {
      workerSupported = false;
      const job = slot.currentJob;
      slot.currentJob = null;
      this.detachAbortHandler(slot);
      if (job) {
        job.reject(new Error('Worker error: ' + event.message));
      }
      this.terminateAllWorkers();
      compressionWorkerPool = null;
    };
  }

  private replaceWorker(slot: WorkerSlot): void {
    slot.worker.terminate();
    slot.worker = this.createWorker();
    this.attachWorkerEvents(slot);
  }

  private terminateAllWorkers(): void {
    for (const slot of this.slots) {
      this.detachAbortHandler(slot);
      slot.worker.terminate();
      if (slot.currentJob) {
        slot.currentJob.reject(new Error('Worker became unavailable'));
        slot.currentJob = null;
      }
    }
    this.slots.length = 0;

    while (this.pendingJobs.length > 0) {
      const job = this.pendingJobs.shift();
      job?.reject(new Error('Worker became unavailable'));
    }
  }

  private ensureWorkerSlot(): WorkerSlot | null {
    if (this.slots.length >= this.maxWorkers) return null;

    try {
      const slot: WorkerSlot = {
        worker: this.createWorker(),
        currentJob: null,
        abortHandler: null,
      };
      this.attachWorkerEvents(slot);
      this.slots.push(slot);
      return slot;
    } catch {
      workerSupported = false;
      this.terminateAllWorkers();
      compressionWorkerPool = null;
      return null;
    }
  }

  private dispatchPendingJobs(): void {
    while (this.pendingJobs.length > 0) {
      const slot = this.slots.find((entry) => entry.currentJob === null) ?? this.ensureWorkerSlot();
      if (!slot) return;

      const job = this.pendingJobs.shift();
      if (!job) return;

      if (job.signal?.aborted) {
        job.reject(new DOMException('Aborted', 'AbortError'));
        continue;
      }

      slot.currentJob = job;
      const onAbort = () => {
        if (slot.currentJob?.id !== job.id) return;
        slot.currentJob = null;
        this.detachAbortHandler(slot);
        try {
          this.replaceWorker(slot);
        } catch {
          workerSupported = false;
          this.terminateAllWorkers();
          compressionWorkerPool = null;
        }
        job.reject(new DOMException('Aborted', 'AbortError'));
        this.dispatchPendingJobs();
      };

      slot.abortHandler = onAbort;
      job.signal?.addEventListener('abort', onAbort, { once: true });

      try {
        slot.worker.postMessage({ id: job.id, file: job.file, opts: job.opts });
      } catch (error) {
        slot.currentJob = null;
        this.detachAbortHandler(slot);
        job.reject(error instanceof Error ? error : new Error('Failed to dispatch worker job'));
        this.dispatchPendingJobs();
      }
    }
  }

  submit(file: File, opts?: CompressOptions, signal?: AbortSignal): Promise<CompressResult> {
    throwIfAborted(signal);
    return new Promise<CompressResult>((resolve, reject) => {
      this.pendingJobs.push({
        id: jobId++,
        file,
        opts,
        signal,
        resolve,
        reject,
      });
      this.dispatchPendingJobs();
    });
  }
}

let compressionWorkerPool: CompressionWorkerPool | null = null;

function compressViaWorker(file: File, opts?: CompressOptions, signal?: AbortSignal): Promise<CompressResult> | null {
  if (workerSupported === false || !isWorkerSupported()) {
    workerSupported = false;
    return null;
  }

  try {
    if (!compressionWorkerPool) {
      compressionWorkerPool = new CompressionWorkerPool();
    }
    workerSupported = true;
    return compressionWorkerPool.submit(file, opts, signal);
  } catch {
    workerSupported = false;
    compressionWorkerPool = null;
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
