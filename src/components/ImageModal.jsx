import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import useFocusTrap from '../hooks/useFocusTrap';

export default memo(function ImageModal({ isOpen, imageSrc, onClose }) {
  const { t } = useTranslation();
  const trapRef = useFocusTrap(isOpen);

  if (!isOpen) return null;

  return (
    <div className="md-scrim" onClick={onClose} role="presentation">
      <div
        ref={trapRef}
        className="md-dialog md-elevation-5"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('modal.imagePreview', 'Image Preview')}
      >
        <button className="md-icon-button md-dialog__close" onClick={onClose} aria-label={t('modal.close', 'Close')}>
          <span className="material-icons-round">close</span>
        </button>
        <img src={imageSrc} alt={t('modal.fullSizePreview', 'Full size preview')} />
      </div>
    </div>
  );
});
