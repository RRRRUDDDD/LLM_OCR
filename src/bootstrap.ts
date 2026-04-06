import { queueManager } from './services/queueManager';
import { healthChecker } from './services/healthCheck';

queueManager.setHealthChecker(() => healthChecker.isHealthy());
