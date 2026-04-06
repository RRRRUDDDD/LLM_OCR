export interface QueueStats {
  active: number;
  pending: number;
  total: number;
  queueSize: number;
  isPaused: boolean;
}
