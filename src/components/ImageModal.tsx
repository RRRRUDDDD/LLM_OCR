import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import useFocusTrap from '../hooks/useFocusTrap';

interface ImageModalProps {
  isOpen: boolean;
  imageSrc: string;
  onClose: () => void;
}

export default memo(function ImageModal({ isOpen, imageSrc, onClose }: ImageModalProps) {
  const { t } = useTranslation();
  const trapRef = useFocusTrap<HTMLDivElement>(isOpen);

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
