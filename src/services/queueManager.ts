import PQueue from 'p-queue';
import { ocrEvents } from '../events/ocrEvents';
import type { QueueStats } from '../types/queue';

type QueueTask = (signal: AbortSignal) => Promise<void>;
type HealthChecker = () => boolean;

class QueueManager {
  private queue: PQueue;
  private activeControllers: Map<string, AbortController>;
  private pendingControllers: Map<string, AbortController>;
  private healthChecker?: HealthChecker;

  constructor({ concurrency = 3 } = {}) {
    this.queue = new PQueue({ concurrency });
    this.activeControllers = new Map();   // imageId -> AbortController (running)
    this.pendingControllers = new Map();  // imageId -> AbortController (waiting)

    this.queue.on('active', () => {
      this.emitStats();
    });

    this.queue.on('idle', () => {
      this.emitStats();
    });
  }

  add(imageId: string, taskFn: QueueTask): void {
    // Cancel existing task for same image (if re-queued)
    if (this.activeControllers.has(imageId) || this.pendingControllers.has(imageId)) {
      this.cancel(imageId);
    }

    const controller = new AbortController();
    this.pendingControllers.set(imageId, controller);

    ocrEvents.emit('ocr:queued', { imageId });
    this.emitStats();

    this.queue.add(async () => {
      // Transition: pending -> active
      this.pendingControllers.delete(imageId);
      this.activeControllers.set(imageId, controller);

      if (controller.signal.aborted) {
        this.activeControllers.delete(imageId);
        return;
      }

      // Wait for healthy service before proceeding
      await this.waitForHealthy(controller.signal);
      if (controller.signal.aborted) {
        this.activeControllers.delete(imageId);
        return;
      }

      ocrEvents.emit('ocr:start', { imageId });

      try {
        await taskFn(controller.signal);
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          // Silently handle abort
        } else {
          ocrEvents.emit('ocr:error', {
            imageId,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      } finally {
        if (this.activeControllers.get(imageId) === controller) {
          this.activeControllers.delete(imageId);
        }
        this.emitStats();
      }
    }).catch(() => {
      // Queue-level error, already handled above
    });
  }

  cancel(imageId: string): void {
    const active = this.activeControllers.get(imageId);
    if (active) {
      active.abort();
      this.activeControllers.delete(imageId);
      ocrEvents.emit('ocr:cancelled', { imageId });
      this.emitStats();
      return;
    }

    const pending = this.pendingControllers.get(imageId);
    if (pending) {
      pending.abort();
      this.pendingControllers.delete(imageId);
      ocrEvents.emit('ocr:cancelled', { imageId });
      this.emitStats();
    }
  }

  cancelAll(): void {
    this.queue.clear();

    for (const [id, controller] of this.activeControllers) {
      controller.abort();
      ocrEvents.emit('ocr:cancelled', { imageId: id });
    }
    for (const [id, controller] of this.pendingControllers) {
      controller.abort();
      ocrEvents.emit('ocr:cancelled', { imageId: id });
    }

    this.activeControllers.clear();
    this.pendingControllers.clear();
    this.emitStats();
  }

  getStats(): QueueStats {
    return {
      active: this.activeControllers.size,
      pending: this.pendingControllers.size,
      total: this.activeControllers.size + this.pendingControllers.size,
      queueSize: this.queue.size,
      isPaused: this.queue.isPaused,
    };
  }

  has(imageId: string): boolean {
    return this.activeControllers.has(imageId) || this.pendingControllers.has(imageId);
  }

  private async waitForHealthy(signal: AbortSignal): Promise<void> {
    if (!this.healthChecker) return;

    const checkInterval = 2000;
    while (!this.healthChecker() && !signal.aborted) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        }, checkInterval);
        const onAbort = () => {
          clearTimeout(timer);
          resolve();
        };
        signal.addEventListener('abort', onAbort, { once: true });
      });
    }
  }

  setHealthChecker(fn: HealthChecker): void {
    this.healthChecker = fn;
  }

  private emitStats(): void {
    ocrEvents.emit('queue:stats', this.getStats());
  }
}

export const queueManager = new QueueManager({ concurrency: 3 });
