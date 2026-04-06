import { memo, useState, useEffect, useRef } from 'react';

interface ImagePreviewProps {
  images: string[];
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
  images,
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
      <div
        className="image-preview"
        onClick={onClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
        aria-label="点击放大查看图片"
      >
        <img
          src={images[currentIndex]}
          alt={`第 ${currentIndex + 1} 张图片预览`}
          className={fadeClass}
          onTransitionEnd={() => setFadeClass('')}
        />
        {isLoading && (
          <div className="loading-overlay" role="status" aria-label="图片识别中">
            <div className="md-circular-progress" aria-hidden="true"></div>
          </div>
        )}
      </div>
    </div>
  );
});
