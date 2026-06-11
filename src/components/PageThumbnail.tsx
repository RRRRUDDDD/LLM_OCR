import { memo } from 'react';
import { PAGE_STATUS } from '../stores/pagesStore';
import type { Page, PageStatus } from '../types/page';

const STATUS_CONFIG = {
  [PAGE_STATUS.IDLE]:       { icon: 'image',           color: 'var(--md-on-surface-variant, #888)', label: 'Ready' },
  [PAGE_STATUS.QUEUED]:     { icon: 'hourglass_empty', color: 'var(--md-warning, #f0a000)',         label: 'Queued' },
  [PAGE_STATUS.PROCESSING]: { icon: 'sync',            color: 'var(--md-primary, #1976d2)',         label: 'Processing', spin: true },
  [PAGE_STATUS.DONE]:       { icon: 'check_circle',    color: 'var(--md-success, #18a058)',         label: 'Done' },
  [PAGE_STATUS.ERROR]:      { icon: 'error',           color: 'var(--md-error, #d32f2f)',           label: 'Error' },
} as const satisfies Record<PageStatus, { icon: string; color: string; label: string; spin?: boolean }>;

interface StatusBadgeProps {
  status: PageStatus;
}

const StatusBadge = memo(function StatusBadge({ status }: StatusBadgeProps) {
  const config: { icon: string; color: string; label: string; spin?: boolean } = STATUS_CONFIG[status] || STATUS_CONFIG[PAGE_STATUS.IDLE];
  return (
    <span
      className="status-badge"
      title={config.label}
      style={{ '--badge-color': config.color }}
    >
      <span
        className={`material-icons-round status-badge__icon ${config.spin ? 'spin' : ''}`}
        aria-hidden="true"
      >
        {config.icon}
      </span>
    </span>
  );
});

const PageThumbnail = memo(function PageThumbnail({
  page,
  isSelected,
  onClick,
  onCancel,
  onDelete,
}: {
  page: Page;
  isSelected: boolean;
  onClick: (page: Page) => void;
  onCancel?: (pageId: string) => void;
  onDelete?: (pageId: string) => void;
}) {
  const isProcessing = page.status === PAGE_STATUS.PROCESSING || page.status === PAGE_STATUS.QUEUED;
  const thumbnailSrc = page.thumbnailUrl || page.imageUrl;
  const placeholderIcon = page.fileType === 'application/pdf' ? 'picture_as_pdf' : 'image';

  return (
    <div
      className={`page-thumbnail ${isSelected ? 'page-thumbnail--selected' : ''}`}
      onClick={() => onClick(page)}
      role="button"
      tabIndex={0}
      aria-label={`${page.fileName} - ${STATUS_CONFIG[page.status]?.label || 'Unknown'}`}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(page); } }}
    >
      {thumbnailSrc ? (
        <img
          src={thumbnailSrc}
          alt={page.fileName}
          className="page-thumbnail__img"
          loading="lazy"
        />
      ) : (
        <div className="page-thumbnail__placeholder">
          <span className="material-icons-round">{placeholderIcon}</span>
        </div>
      )}

      <StatusBadge status={page.status} />

      {isProcessing && onCancel && (
        <button
          className="page-thumbnail__cancel"
          onClick={(e) => {
            e.stopPropagation();
            onCancel(page.id);
          }}
          title="Cancel OCR"
          aria-label={`Cancel OCR for ${page.fileName}`}
        >
          <span className="material-icons-round" aria-hidden="true">close</span>
        </button>
      )}

      {!isProcessing && onDelete && (
        <button
          className="page-thumbnail__cancel"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(page.id);
          }}
          title="Delete page"
          aria-label={`Delete ${page.fileName}`}
        >
          <span className="material-icons-round" aria-hidden="true">delete</span>
        </button>
      )}

      <span className="page-thumbnail__name" title={page.fileName}>
        {page.fileName}
      </span>
    </div>
  );
});

export { StatusBadge, PageThumbnail };
export default PageThumbnail;
