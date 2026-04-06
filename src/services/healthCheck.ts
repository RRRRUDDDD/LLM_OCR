import { ocrEvents } from '../events/ocrEvents';
import type { HealthStatus } from '../types/events';

const STATUS_HEALTHY = 'healthy';
const STATUS_DEGRADED = 'degraded';
const STATUS_UNAVAILABLE = 'unavailable';

export { STATUS_HEALTHY, STATUS_DEGRADED, STATUS_UNAVAILABLE };

class HealthCheckService {
  private status: HealthStatus;
  private consecutiveFailures: number;
  private lastCheckTime: Date | null;
  private maxFailuresBeforeUnhealthy: number;
  private unavailableCooldownMs: number;

  constructor() {
    this.status = STATUS_HEALTHY;
    this.consecutiveFailures = 0;
    this.lastCheckTime = null;
    this.maxFailuresBeforeUnhealthy = 3;
    this.unavailableCooldownMs = 10_000;
  }

  reportSuccess(): void {
    this.consecutiveFailures = 0;
    this.lastCheckTime = new Date();
    this.setStatus(STATUS_HEALTHY);
  }

  reportRateLimit(): void {
    this.consecutiveFailures = 0;
    this.lastCheckTime = new Date();
    this.setStatus(STATUS_DEGRADED);
  }

  reportFailure(): void {
    this.consecutiveFailures++;
    this.lastCheckTime = new Date();
    if (this.consecutiveFailures >= this.maxFailuresBeforeUnhealthy) {
      this.setStatus(STATUS_UNAVAILABLE);
    }
  }

  getStatus(): HealthStatus {
    return this.status;
  }

  isHealthy(): boolean {
    return this.getRetryDelayMs() === 0;
  }

  getLastCheckTime(): Date | null {
    return this.lastCheckTime;
  }

  getRetryDelayMs(now = Date.now()): number {
    if (this.status !== STATUS_UNAVAILABLE || !this.lastCheckTime) return 0;

    const elapsed = now - this.lastCheckTime.getTime();
    return Math.max(0, this.unavailableCooldownMs - elapsed);
  }

  getInfo(): { status: HealthStatus; consecutiveFailures: number; lastCheckTime: Date | null } {
    return {
      status: this.status,
      consecutiveFailures: this.consecutiveFailures,
      lastCheckTime: this.lastCheckTime,
    };
  }

  private setStatus(newStatus: HealthStatus): void {
    if (this.status === newStatus) return;
    const prevStatus = this.status;
    this.status = newStatus;
    ocrEvents.emit('health:changed', { status: newStatus, prevStatus });
  }
}

export const healthChecker = new HealthCheckService();
