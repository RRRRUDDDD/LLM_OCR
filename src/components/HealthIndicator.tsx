import { useState, useEffect, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { ocrEvents } from '../events/ocrEvents';
import { STATUS_HEALTHY, STATUS_DEGRADED, STATUS_UNAVAILABLE } from '../services/healthCheck';
import type { HealthStatus, OcrEventMap } from '../types/events';

const STATUS_CONFIG = {
  [STATUS_HEALTHY]:     { icon: 'wifi',     modifier: 'healthy',     labelKey: 'health.connected' },
  [STATUS_DEGRADED]:    { icon: 'wifi',     modifier: 'degraded',    labelKey: 'health.rateLimited' },
  [STATUS_UNAVAILABLE]: { icon: 'wifi_off', modifier: 'unavailable', labelKey: 'health.unavailable' },
} as const satisfies Record<HealthStatus, { icon: string; modifier: string; labelKey: string }>;

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
      className={`health-indicator health-indicator--${config.modifier}`}
      title={t(config.labelKey)}
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
