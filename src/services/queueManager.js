import PQueue from 'p-queue';
import { ocrEvents } from '../events/ocrEvents';

class QueueManager {
  constructor({ concurrency = 3 } = {}) {
    this._queue = new PQueue({ concurrency });
    this._activeControllers = new Map();   // imageId -> AbortController (running)
    this._pendingControllers = new Map();  // imageId -> AbortController (waiting)

    this._queue.on('active', () => {
      this._emitStats();
    });

    this._queue.on('idle', () => {
      this._emitStats();
    });
  }

 add(imageId, taskFn) {
    // Cancel existing task for same image (if re-queued)
    if (this._activeControllers.has(imageId) || this._pendingControllers.has(imageId)) {
      this.cancel(imageId);
    }

    const controller = new AbortController();
    this._pendingControllers.set(imageId, controller);

    ocrEvents.emit('ocr:queued', { imageId });
    this._emitStats();

    this._queue.add(async () => {
      // Transition: pending -> active
      this._pendingControllers.delete(imageId);
      this._activeControllers.set(imageId, controller);

      if (controller.signal.aborted) {
        this._activeControllers.delete(imageId);
        return;
      }

      // Wait for healthy service before proceeding
      await this._waitForHealthy(controller.signal, imageId);
      if (controller.signal.aborted) {
        this._activeControllers.delete(imageId);
        return;
      }

      ocrEvents.emit('ocr:start', { imageId });

      try {
        await taskFn(controller.signal);
      } catch (error) {
        if (error.name === 'AbortError') {
          // Silently handle abort
        } else {
          ocrEvents.emit('ocr:error', { imageId, error });
        }
      } finally {
        if (this._activeControllers.get(imageId) === controller) {
          this._activeControllers.delete(imageId);
        }
        this._emitStats();
      }
    }).catch(() => {
      // Queue-level error, already handled above
    });
  }

 cancel(imageId) {
    const active = this._activeControllers.get(imageId);
    if (active) {
      active.abort();
      this._activeControllers.delete(imageId);
      ocrEvents.emit('ocr:cancelled', { imageId });
      this._emitStats();
      return;
    }

    const pending = this._pendingControllers.get(imageId);
    if (pending) {
      pending.abort();
      this._pendingControllers.delete(imageId);
      ocrEvents.emit('ocr:cancelled', { imageId });
      this._emitStats();
    }
  }

  cancelAll() {
    this._queue.clear();

    for (const [id] of this._activeControllers) {
      this.cancel(id);
    }
    for (const [id] of this._pendingControllers) {
      this.cancel(id);
    }

    this._activeControllers.clear();
    this._pendingControllers.clear();
    this._emitStats();
  }
getStats() {
    return {
      active: this._activeControllers.size,
      pending: this._pendingControllers.size,
      total: this._activeControllers.size + this._pendingControllers.size,
      queueSize: this._queue.size,
      isPaused: this._queue.isPaused,
    };
  }

 has(imageId) {
    return this._activeControllers.has(imageId) || this._pendingControllers.has(imageId);
  }

 async _waitForHealthy(signal, _imageId) {
    if (!this._healthChecker) return;

    const checkInterval = 2000;
    while (!this._healthChecker() && !signal.aborted) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, checkInterval);
        const onAbort = () => {
          clearTimeout(timer);
          resolve();
        };
        signal.addEventListener('abort', onAbort, { once: true });
      });
    }
  }

 setHealthChecker(fn) {
    this._healthChecker = fn;
  }

  _emitStats() {
    ocrEvents.emit('queue:stats', this.getStats());
  }
}

export const queueManager = new QueueManager({ concurrency: 3 });
