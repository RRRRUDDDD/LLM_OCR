import { ocrEvents } from '../events/ocrEvents';

const STATUS_HEALTHY = 'healthy';
const STATUS_DEGRADED = 'degraded';
const STATUS_UNAVAILABLE = 'unavailable';

export { STATUS_HEALTHY, STATUS_DEGRADED, STATUS_UNAVAILABLE };

class HealthCheckService {
  constructor() {
    this._status = STATUS_HEALTHY;
    this._consecutiveFailures = 0;
    this._lastCheckTime = null;
    this._maxFailuresBeforeUnhealthy = 3;
    this._listeners = new Set();
  }

  reportSuccess() {
    this._consecutiveFailures = 0;
    this._lastCheckTime = new Date();
    this._setStatus(STATUS_HEALTHY);
  }

  reportRateLimit() {
    this._lastCheckTime = new Date();
    this._setStatus(STATUS_DEGRADED);
  }

  reportFailure() {
    this._consecutiveFailures++;
    this._lastCheckTime = new Date();
    if (this._consecutiveFailures >= this._maxFailuresBeforeUnhealthy) {
      this._setStatus(STATUS_UNAVAILABLE);
    }
  }

 getStatus() {
    return this._status;
  }

  isHealthy() {
    return this._status !== STATUS_UNAVAILABLE;
  }

 getLastCheckTime() {
    return this._lastCheckTime;
  }

  getInfo() {
    return {
      status: this._status,
      consecutiveFailures: this._consecutiveFailures,
      lastCheckTime: this._lastCheckTime,
    };
  }

  _setStatus(newStatus) {
    if (this._status === newStatus) return;
    const prevStatus = this._status;
    this._status = newStatus;
    ocrEvents.emit('health:changed', { status: newStatus, prevStatus });
  }
}

export const healthChecker = new HealthCheckService();
