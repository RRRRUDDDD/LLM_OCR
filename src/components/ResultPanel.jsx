import { memo, lazy, Suspense, useMemo } from 'react';

// Lazy-load KaTeX renderer — katex bundle (~330KB) only fetched when math content is present
const KaTeXLine = lazy(() => import('./KaTeXLine'));

/**
 * Fix #8: Memoize individual text lines to avoid re-rendering/re-parsing KaTeX
 * for lines that haven't changed during streaming.
 */
const TextLine = memo(function TextLine({ line, index }) {
  return (
    <div className="text-line" style={{ '--line-index': index }}>
      {line.includes('$') ? (
        <Suspense fallback={line}>
          <KaTeXLine line={line} />
        </Suspense>
      ) : (
        line || '\u00A0'
      )}
    </div>
  );
});

export default function ResultPanel({
  result,
  isLoading,
  currentIndex,
  totalImages,
  onCopy,
  onCopyAll,
}) {
  const hasResult = result && result.length > 0;
  const showPanel = hasResult || isLoading;
  // Memoize line splitting — avoid re-creating array on every streaming render
  const lines = useMemo(() => (hasResult ? result.split('\n') : []), [result]);

  if (!showPanel) return null;

  return (
    <section className="result-card md-card md-elevation-1">
      {isLoading && (
        <div className="md-linear-progress"><div className="md-linear-progress__bar"></div></div>
      )}
      <div className="result-container">
        {isLoading && !hasResult && (
          <div className="loading-state">
            <span className="material-icons-round loading-state__icon">hourglass_top</span>
            <span>识别中...</span>
          </div>
        )}
        {hasResult && (
          <div className="result-text">
            <div className="result-header">
              <div className="result-header__info">
                <span className="material-icons-round">description</span>
                <span>第 {currentIndex + 1} 张图片的识别结果</span>
              </div>
              <div className="result-header__actions">
                <button className="md-button md-button--tonal" onClick={onCopy}>
                  <span className="material-icons-round">content_copy</span>
                  <span>复制内容</span>
                </button>
                {totalImages > 1 && (
                  <button className="md-button md-button--outlined" onClick={onCopyAll}>
                    <span className="material-icons-round">copy_all</span>
                    <span>复制全部</span>
                  </button>
                )}
              </div>
            </div>
            <div className="result-body">
              <div className={`streaming-text ${isLoading ? 'is-streaming' : ''}`}>
                {lines.map((line, index) => (
                  <TextLine key={index} line={line} index={index} />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
