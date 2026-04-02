import { memo, lazy, Suspense, useMemo, useState, useRef, useEffect, useCallback } from 'react';
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

/**
 * Dropdown menu that appears below a button.
 * Closes on outside click or Escape.
 */
function DropdownMenu({ items, onClose }) {
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose();
    };
    const handleEsc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [onClose]);

  return (
    <div ref={menuRef} className="export-dropdown" role="menu">
      {items.map((item) => (
        <button
          key={item.key}
          className="export-dropdown__item"
          role="menuitem"
          onClick={() => { item.onClick(); onClose(); }}
        >
          <span className="material-icons-round" aria-hidden="true">{item.icon}</span>
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Button with an attached dropdown for export options.
 */
function ButtonWithDropdown({ label, icon, onClick, dropdownItems, disabled }) {
  const [showDropdown, setShowDropdown] = useState(false);
  const containerRef = useRef(null);

  const handleMainClick = useCallback(() => {
    onClick();
  }, [onClick]);

  const handleDropdownToggle = useCallback((e) => {
    e.stopPropagation();
    setShowDropdown((v) => !v);
  }, []);

  const closeDropdown = useCallback(() => setShowDropdown(false), []);

  if (!dropdownItems || dropdownItems.length === 0) {
    return (
      <button className="md-button md-button--filled" onClick={handleMainClick} disabled={disabled}>
        <span className="material-icons-round" aria-hidden="true">{icon}</span>
        <span>{label}</span>
      </button>
    );
  }

  return (
    <div className="button-with-dropdown" ref={containerRef}>
      <div className="button-with-dropdown__group">
        <button className="md-button md-button--filled button-with-dropdown__main" onClick={handleMainClick} disabled={disabled}>
          <span className="material-icons-round" aria-hidden="true">{icon}</span>
          <span>{label}</span>
        </button>
        <button
          className="md-button md-button--filled button-with-dropdown__trigger"
          onClick={handleDropdownToggle}
          disabled={disabled}
          aria-label="Export options"
          aria-expanded={showDropdown}
        >
          <span className="material-icons-round" aria-hidden="true">
            {showDropdown ? 'expand_less' : 'expand_more'}
          </span>
        </button>
      </div>
      {showDropdown && <DropdownMenu items={dropdownItems} onClose={closeDropdown} />}
    </div>
  );
}

export default function ResultPanel({
  result,
  isLoading,
  currentIndex,
  totalImages,
  onCopy,
  onCopyAll,
  status,
  onExport,
  onExportAll,
}) {
  const hasResult = result && result.length > 0;
  const showPanel = hasResult || isLoading;
  const isStreaming = isLoading || status === 'processing';
  const lines = useMemo(() => (hasResult ? result.split('\n') : []), [result]);
  const isDone = status === 'done';

  const singleExportItems = useMemo(() => {
    if (!onExport || !isDone) return null;
    return [
      { key: 'md', icon: 'description', label: 'Markdown', onClick: () => onExport('md') },
      { key: 'txt', icon: 'text_snippet', label: 'Text', onClick: () => onExport('txt') },
      { key: 'docx', icon: 'article', label: 'Word', onClick: () => onExport('docx') },
    ];
  }, [onExport, isDone]);

  const allExportItems = useMemo(() => {
    if (!onExportAll || !isDone || totalImages <= 1) return null;
    return [
      { key: 'md', icon: 'description', label: 'Markdown', onClick: () => onExportAll('md') },
      { key: 'txt', icon: 'text_snippet', label: 'Text', onClick: () => onExportAll('txt') },
      { key: 'docx', icon: 'article', label: 'Word', onClick: () => onExportAll('docx') },
    ];
  }, [onExportAll, isDone, totalImages]);

  if (!showPanel) return null;

  return (
    <section className="result-card md-card md-elevation-1" aria-label="OCR result">
      {isLoading && (
        <div className="md-linear-progress" role="progressbar" aria-label="Processing" aria-valuemin={0} aria-valuemax={100}>
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
            <span>Recognizing...</span>
          </div>
        )}
        {hasResult && (
          <div key={currentIndex} className="result-text result-text--enter">
            <div className="result-header">
              <div className="result-header__info" aria-hidden="true">
                <span className="material-icons-round">description</span>
                <span>Page {currentIndex + 1} result</span>
              </div>
              <div className="result-header__actions">
                <ButtonWithDropdown
                  label="Copy"
                  icon="content_copy"
                  onClick={onCopy}
                  dropdownItems={singleExportItems}
                />
                {totalImages > 1 && (
                  <ButtonWithDropdown
                    label="Copy All"
                    icon="copy_all"
                    onClick={onCopyAll}
                    dropdownItems={allExportItems}
                  />
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
  onExport: PropTypes.func,
  onExportAll: PropTypes.func,
};
