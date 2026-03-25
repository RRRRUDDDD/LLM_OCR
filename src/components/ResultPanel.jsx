import { memo, lazy, Suspense, useMemo } from 'react';
import PropTypes from 'prop-types';

const KaTeXLine = lazy(() => import('./KaTeXLine'));

const TextLine = memo(function TextLine({ line, index, isStreaming }) {
  const hasMath = line.includes('$');
  return (
    <div className="text-line" style={{ '--line-index': index }}>
      {hasMath && !isStreaming ? (
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
  status,
}) {
  const hasResult = result && result.length > 0;
  const showPanel = hasResult || isLoading;
  // P3-2：isStreaming = 正在接收数据块（status=processing 或 loading 且有部分结果）
  const isStreaming = isLoading || status === 'processing';
  // 对行分割结果 Memoize——避免在每次流式渲染时重新创建数组
  const lines = useMemo(() => (hasResult ? result.split('\n') : []), [result]);

  if (!showPanel) return null;

  return (
    <section className="result-card md-card md-elevation-1" aria-label="OCR 识别结果">
      {isLoading && (
        <div className="md-linear-progress" role="progressbar" aria-label="识别中" aria-valuemin={0} aria-valuemax={100}>
          <div className="md-linear-progress__bar"></div>
        </div>
      )}
      <div
        className="result-container"
        aria-live="polite"
        aria-atomic="false"
        aria-relevant="additions text"
      >
        {isLoading && !hasResult && (
          <div className="loading-state" role="status">
            <span className="material-icons-round loading-state__icon" aria-hidden="true">hourglass_top</span>
            <span>识别中...</span>
          </div>
        )}
        {hasResult && (
          <div key={currentIndex} className="result-text result-text--enter">
            <div className="result-header">
              <div className="result-header__info" aria-hidden="true">
                <span className="material-icons-round">description</span>
                <span>第 {currentIndex + 1} 张图片的识别结果</span>
              </div>
              <div className="result-header__actions">
                <button className="md-button md-button--filled" onClick={onCopy} aria-label="复制当前识别结果">
                  <span className="material-icons-round" aria-hidden="true">content_copy</span>
                  <span>复制内容</span>
                </button>
                {totalImages > 1 && (
                  <button className="md-button md-button--outlined" onClick={onCopyAll} aria-label={`复制全部 ${totalImages} 张图片的识别结果`}>
                    <span className="material-icons-round" aria-hidden="true">copy_all</span>
                    <span>复制全部</span>
                  </button>
                )}
              </div>
            </div>
            <div className="result-body">
              <div className={`streaming-text ${isLoading ? 'is-streaming' : ''}`}>
                {lines.map((line, index) => (
                  <TextLine key={index} line={line} index={index} isStreaming={isStreaming} />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

ResultPanel.propTypes = {
  result: PropTypes.string,
  isLoading: PropTypes.bool,
  currentIndex: PropTypes.number,
  totalImages: PropTypes.number,
  onCopy: PropTypes.func,
  onCopyAll: PropTypes.func,
  status: PropTypes.string,
};
