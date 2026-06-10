import { useState, useEffect, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { ocrEvents } from '../events/ocrEvents';
import { STATUS_HEALTHY, STATUS_DEGRADED, STATUS_UNAVAILABLE } from '../services/healthCheck';
import type { HealthStatus, OcrEventMap } from '../types/events';

const STATUS_CONFIG = {
  [STATUS_HEALTHY]:     { icon: 'wifi',     color: '#18a058', labelKey: 'health.connected' },
  [STATUS_DEGRADED]:    { icon: 'wifi',     color: '#f0a000', labelKey: 'health.rateLimited' },
  [STATUS_UNAVAILABLE]: { icon: 'wifi_off', color: '#d32f2f', labelKey: 'health.unavailable' },
} as const satisfies Record<HealthStatus, { icon: string; color: string; labelKey: string }>;

const HealthIndicator = memo(function HealthIndicator() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<HealthStatus>(STATUS_HEALTHY);

  useEffect(() => {
    const handler = ({ status: newStatus }: OcrEventMap['health:changed']) => {
      setStatus(newStatus);
    };
    ocrEvents.on('health:changed', handler);
    return () => ocrEvents.off('health:changed', handler);
  }, []);

  const config = STATUS_CONFIG[status] || STATUS_CONFIG[STATUS_HEALTHY];

  return (
    <span
      className="health-indicator"
      title={t(config.labelKey)}
      style={{ '--health-color': config.color }}
    >
      <span className="material-icons-round health-indicator__icon" aria-hidden="true">
        {config.icon}
      </span>
      {status !== STATUS_HEALTHY && (
        <span className="health-indicator__label">{t(config.labelKey)}</span>
      )}
    </span>
  );
});

export default HealthIndicator;
