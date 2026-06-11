import { memo, useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

interface ImagePreviewProps {
  imageSrc: string;
  fileType?: string;
  fileName?: string;
  totalImages: number;
  currentIndex: number;
  isLoading: boolean;
  canGoPrev: boolean;
  canGoNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClick: () => void;
  onClear?: () => void;
}

export default memo(function ImagePreview({
  imageSrc,
  fileType,
  fileName,
  totalImages,
  currentIndex,
  isLoading,
  canGoPrev,
  canGoNext,
  onPrev,
  onNext,
  onClick,
  onClear,
}: ImagePreviewProps) {
  const { t } = useTranslation();
  // 图片切换时的淡入淡出过渡
  const [fadeClass, setFadeClass] = useState('');
  const prevIndexRef = useRef(currentIndex);

  useEffect(() => {
    if (prevIndexRef.current !== currentIndex) {
      setFadeClass('fade-enter');
      const raf = requestAnimationFrame(() => {
        setFadeClass('fade-active');
      });
      prevIndexRef.current = currentIndex;
      return () => cancelAnimationFrame(raf);
    }
  }, [currentIndex]);

  if (totalImages === 0) return null;
  const hasPreview = Boolean(imageSrc);
  const isPdf = fileType === 'application/pdf';

  return (
    <div className="image-preview-wrapper">
      <div className="image-navigation">
        <button onClick={onPrev} disabled={!canGoPrev} className="md-icon-button" aria-label={t('preview.prev')}>
          <span className="material-icons-round">chevron_left</span>
        </button>
        <span className="image-counter">{currentIndex + 1} / {totalImages}</span>
        <button onClick={onNext} disabled={!canGoNext} className="md-icon-button" aria-label={t('preview.next')}>
          <span className="material-icons-round">chevron_right</span>
        </button>
        {onClear && (
          <button onClick={onClear} className="md-icon-button" aria-label={t('preview.clearAll')} title={t('preview.clearAll')}>
            <span className="material-icons-round">delete_sweep</span>
          </button>
        )}
      </div>
      <div
        className={`image-preview ${!hasPreview ? 'image-preview--placeholder' : ''}`}
        onClick={hasPreview ? onClick : undefined}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (!hasPreview) return;
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); }
        }}
        aria-label={hasPreview ? t('preview.clickToZoom') : t('preview.noPreview')}
      >
        {hasPreview ? (
          <img
            src={imageSrc}
            alt={t('preview.imageAlt', { index: currentIndex + 1 })}
            className={fadeClass}
            onTransitionEnd={() => setFadeClass('')}
          />
        ) : (
          <div className="image-preview__placeholder">
            <span className="material-icons-round" aria-hidden="true">
              {isPdf ? 'picture_as_pdf' : 'image_not_supported'}
            </span>
            <span className="image-preview__placeholder-text">
              {fileName || (isPdf ? 'PDF' : t('preview.noPreview'))}
            </span>
          </div>
        )}
        {isLoading && (
          <div className="loading-overlay" role="status" aria-label={t('result.recognizing')}>
            <div className="md-circular-progress" aria-hidden="true"></div>
          </div>
        )}
      </div>
    </div>
  );
});
