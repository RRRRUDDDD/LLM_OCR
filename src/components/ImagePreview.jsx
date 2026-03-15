import { memo } from 'react';

export default memo(function ImagePreview({
  images,
  currentIndex,
  isLoading,
  canGoPrev,
  canGoNext,
  onPrev,
  onNext,
  onClick,
  onClear,
}) {
  if (images.length === 0) return null;

  return (
    <div className="image-preview-wrapper">
      <div className="image-navigation">
        <button onClick={onPrev} disabled={!canGoPrev} className="md-icon-button" aria-label="上一张">
          <span className="material-icons-round">chevron_left</span>
        </button>
        <span className="image-counter">{currentIndex + 1} / {images.length}</span>
        <button onClick={onNext} disabled={!canGoNext} className="md-icon-button" aria-label="下一张">
          <span className="material-icons-round">chevron_right</span>
        </button>
        {onClear && (
          <button onClick={onClear} className="md-icon-button" aria-label="清除所有图片" title="清除所有">
            <span className="material-icons-round">delete_sweep</span>
          </button>
        )}
      </div>
      <div className="image-preview" onClick={onClick}>
        <img src={images[currentIndex]} alt={`第 ${currentIndex + 1} 张图片预览`} />
        {isLoading && (
          <div className="loading-overlay">
            <div className="md-circular-progress"></div>
          </div>
        )}
      </div>
    </div>
  );
});
