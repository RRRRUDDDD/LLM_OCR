import { memo, useState, useEffect, useRef } from 'react';

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
        <button onClick={onPrev} disabled={!canGoPrev} className="md-icon-button" aria-label="上一张">
          <span className="material-icons-round">chevron_left</span>
        </button>
        <span className="image-counter">{currentIndex + 1} / {totalImages}</span>
        <button onClick={onNext} disabled={!canGoNext} className="md-icon-button" aria-label="下一张">
          <span className="material-icons-round">chevron_right</span>
        </button>
        {onClear && (
          <button onClick={onClear} className="md-icon-button" aria-label="清除所有图片" title="清除所有">
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
        aria-label={hasPreview ? '点击放大查看图片' : '当前文件无图片预览'}
      >
        {hasPreview ? (
          <img
            src={imageSrc}
            alt={`第 ${currentIndex + 1} 张图片预览`}
            className={fadeClass}
            onTransitionEnd={() => setFadeClass('')}
          />
        ) : (
          <div className="image-preview__placeholder">
            <span className="material-icons-round" aria-hidden="true">
              {isPdf ? 'picture_as_pdf' : 'image_not_supported'}
            </span>
            <span className="image-preview__placeholder-text">
              {fileName || (isPdf ? 'PDF' : 'Preview unavailable')}
            </span>
          </div>
        )}
        {isLoading && (
          <div className="loading-overlay" role="status" aria-label="图片识别中">
            <div className="md-circular-progress" aria-hidden="true"></div>
          </div>
        )}
      </div>
    </div>
  );
});
