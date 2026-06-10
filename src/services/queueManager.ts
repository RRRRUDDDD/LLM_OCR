import PQueue from 'p-queue';
import { ocrEvents } from '../events/ocrEvents';
import type { QueueStats } from '../types/queue';

type QueueTask = (signal: AbortSignal) => Promise<void>;
type HealthChecker = () => boolean;

export interface QueueConfig {
  concurrency?: number;
  requestsPerMinute?: number;
}

export const DEFAULT_CONCURRENCY = 3;
/** 0 disables rate limiting (legacy behavior). */
export const DEFAULT_REQUESTS_PER_MINUTE = 0;
const RATE_WINDOW_MS = 60_000;

class QueueManager {
  private queue: PQueue;
  private activeControllers: Map<string, AbortController>;
  private pendingControllers: Map<string, AbortController>;
  private healthChecker?: HealthChecker;
  private requestsPerMinute: number;
  private startTimestamps: number[] = [];

  constructor({ concurrency = DEFAULT_CONCURRENCY, requestsPerMinute = DEFAULT_REQUESTS_PER_MINUTE }: QueueConfig = {}) {
    this.queue = new PQueue({ concurrency });
    this.requestsPerMinute = requestsPerMinute;
    this.activeControllers = new Map();   // imageId -> AbortController (running)
    this.pendingControllers = new Map();  // imageId -> AbortController (waiting)

    this.queue.on('active', () => {
      this.emitStats();
    });

    this.queue.on('idle', () => {
      this.emitStats();
    });
  }

  /** Apply user settings at runtime; in-flight tasks are unaffected. */
  configure({ concurrency, requestsPerMinute }: QueueConfig): void {
    if (typeof concurrency === 'number' && Number.isFinite(concurrency) && concurrency >= 1) {
      this.queue.concurrency = Math.floor(concurrency);
    }
    if (typeof requestsPerMinute === 'number' && Number.isFinite(requestsPerMinute) && requestsPerMinute >= 0) {
      this.requestsPerMinute = Math.floor(requestsPerMinute);
    }
  }

  getConfig(): Required<QueueConfig> {
    return {
      concurrency: this.queue.concurrency,
      requestsPerMinute: this.requestsPerMinute,
    };
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

      // Respect the user-configured requests-per-minute budget
      await this.waitForRateSlot(controller.signal);
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

  private delay(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private async waitForHealthy(signal: AbortSignal): Promise<void> {
    if (!this.healthChecker) return;

    const checkInterval = 2000;
    while (!this.healthChecker() && !signal.aborted) {
      await this.delay(checkInterval, signal);
    }
  }

  /**
   * Sliding-window rate limiter: a task may start only when fewer than
   * `requestsPerMinute` tasks have started within the last 60 s. Aborted
   * waiters return without consuming a slot.
   */
  private async waitForRateSlot(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      if (this.requestsPerMinute <= 0) return;

      const now = Date.now();
      this.startTimestamps = this.startTimestamps.filter((ts) => now - ts < RATE_WINDOW_MS);

      if (this.startTimestamps.length < this.requestsPerMinute) {
        this.startTimestamps.push(now);
        return;
      }

      await this.delay(this.startTimestamps[0] + RATE_WINDOW_MS - now, signal);
    }
  }

  setHealthChecker(fn: HealthChecker): void {
    this.healthChecker = fn;
  }

  private emitStats(): void {
    ocrEvents.emit('queue:stats', this.getStats());
  }
}

export const queueManager = new QueueManager({ concurrency: DEFAULT_CONCURRENCY });
