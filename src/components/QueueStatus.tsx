import { useState, useEffect, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { ocrEvents } from '../events/ocrEvents';
import type { QueueStats } from '../types/queue';

const QueueStatus = memo(function QueueStatus() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<QueueStats>({ active: 0, pending: 0, total: 0, queueSize: 0, isPaused: false });

  useEffect(() => {
    const handler = (newStats: QueueStats) => setStats(newStats);
    ocrEvents.on('queue:stats', handler);
    return () => ocrEvents.off('queue:stats', handler);
  }, []);

  if (stats.total === 0) return null;

  return (
    <span className="queue-status" title={`${t('queue.active')}: ${stats.active}, ${t('queue.pending')}: ${stats.pending}`}>
      <span className="material-icons-round queue-status__icon" aria-hidden="true">
        queue
      </span>
      <span className="queue-status__count">{stats.total}</span>
    </span>
  );
});

export default QueueStatus;
