import { memo } from 'react';
import useFocusTrap from '../hooks/useFocusTrap';

export default memo(function ImageModal({ isOpen, imageSrc, onClose }) {
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
        aria-label="Image preview"
      >
        <button className="md-icon-button md-dialog__close" onClick={onClose} aria-label="Close">
          <span className="material-icons-round">close</span>
        </button>
        <img src={imageSrc} alt="Full size preview" />
      </div>
    </div>
  );
});
