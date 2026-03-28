function isWorkerSupported() {
  return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined';
}

let _worker = null;
let _workerSupported = null;
let _pendingJobs = new Map(); 
let _jobId = 0;

function getWorker() {
  if (_workerSupported === false) return null;
  if (_worker) return _worker;

  if (!isWorkerSupported()) {
    _workerSupported = false;
    return null;
  }

  try {
    _worker = new Worker(new URL('./compressWorker.js', import.meta.url), { type: 'module' });
    _workerSupported = true;

    _worker.onmessage = (e) => {
      const { id, base64, mimeType, error } = e.data;
      const job = _pendingJobs.get(id);
      if (!job) return;
      _pendingJobs.delete(id);
      if (error) {
        job.reject(new Error(error));
      } else {
        job.resolve({ base64, mimeType });
      }
    };

    _worker.onerror = (e) => {
      _workerSupported = false;
      _worker = null;
      for (const job of _pendingJobs.values()) {
        job.reject(new Error('Worker error: ' + e.message));
      }
      _pendingJobs.clear();
    };

    return _worker;
  } catch {
    _workerSupported = false;
    return null;
  }
}

function compressViaWorker(file, opts) {
  const worker = getWorker();
  if (!worker) return null;

  const id = _jobId++;
  return new Promise((resolve, reject) => {
    _pendingJobs.set(id, { resolve, reject });
    worker.postMessage({ id, file, opts });
  });
}

let _webpSupported = null;

function detectWebPSupport() {
  if (_webpSupported !== null) return _webpSupported;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  _webpSupported = canvas.toDataURL('image/webp', 0.5).startsWith('data:image/webp');
  return _webpSupported;
}

function compressOnMainThread(file, opts = {}) {
  const { maxDim = 2048, quality = 0.85, threshold = 1_048_576 } = opts;

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      const needsResize = img.naturalWidth > maxDim || img.naturalHeight > maxDim;
      const needsCompress = file.size > threshold;

      if (!needsResize && !needsCompress) {
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
      ctx.drawImage(img, 0, 0, width, height);

      let outputType;
      if (file.type === 'image/png') {
        outputType = 'image/png';
      } else {
        outputType = detectWebPSupport() ? 'image/webp' : 'image/jpeg';
      }
      const effectiveQuality = outputType === 'image/png' ? undefined : quality;

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            canvas.width = canvas.height = 0;
            reject(new Error('Failed to compress image'));
            return;
          }
          const reader = new FileReader();
          reader.onloadend = () => {
            const dataUrl = reader.result;
            const commaIdx = dataUrl.indexOf(',');
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

export default async function compressImage(file, opts = {}) {
  const workerResult = compressViaWorker(file, opts);
  if (workerResult) {
    try {
      return await workerResult;
    } catch {
      // Worker 失败时回退主线程
      return compressOnMainThread(file, opts);
    }
  }
  return compressOnMainThread(file, opts);
}
