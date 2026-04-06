import { memo, lazy, Suspense, useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import type { PageStatus } from '../types/page';
import type { ExportFormat } from '../types/ui';

const KaTeXLine = lazy(() => import('./KaTeXLine'));

interface DropdownItem {
  key: ExportFormat;
  icon: string;
  label: string;
  onClick: () => void;
}

interface TextLineProps {
  line: string;
  index: number;
  isStreaming: boolean;
}

interface MarkdownResultProps {
  content: string;
}

interface DropdownMenuProps {
  items: DropdownItem[];
  onClose: () => void;
}

interface ButtonWithDropdownProps {
  label: string;
  icon: string;
  onClick?: () => void;
  dropdownItems?: DropdownItem[] | null;
  disabled?: boolean;
}

export interface ResultPanelProps {
  result: string;
  isLoading: boolean;
  currentIndex: number;
  totalImages: number;
  hasPendingPages?: boolean;
  onCopy?: () => void;
  onCopyAll?: () => void;
  status: PageStatus;
  onExport?: (format: ExportFormat) => void;
  onExportAll?: (format: ExportFormat) => void;
}

const TextLine = memo(function TextLine({ line, index, isStreaming }: TextLineProps) {
  const hasMath = /\$[^$]+\$/.test(line);
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

const MarkdownResult = memo(function MarkdownResult({ content }: MarkdownResultProps) {
  return (
    <div className="markdown-result">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});

function DropdownMenu({ items, onClose }: DropdownMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (menuRef.current && event.target instanceof Node && !menuRef.current.contains(event.target)) onClose();
    };
    const handleEsc = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };

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

function ButtonWithDropdown({
  label,
  icon,
  onClick,
  dropdownItems,
  disabled = false,
}: ButtonWithDropdownProps) {
  const [showDropdown, setShowDropdown] = useState(false);

  const handleMainClick = useCallback(() => {
    onClick?.();
  }, [onClick]);

  const handleDropdownToggle = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setShowDropdown((visible) => !visible);
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
    <div className="button-with-dropdown">
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
  hasPendingPages = false,
  onCopy,
  onCopyAll,
  status,
  onExport,
  onExportAll,
}: ResultPanelProps) {
  const { t } = useTranslation();
  const hasResult = result.length > 0;
  const showPanel = hasResult || isLoading;
  const isStreaming = isLoading || status === 'processing';
  const isDone = status === 'done';

  const lines = useMemo(() => (hasResult ? result.split('\n') : []), [result, hasResult]);

  const singleExportItems = useMemo<DropdownItem[] | null>(() => {
    if (!onExport || !isDone) return null;
    return [
      { key: 'md', icon: 'description', label: 'Markdown', onClick: () => onExport('md') },
      { key: 'txt', icon: 'text_snippet', label: 'Text', onClick: () => onExport('txt') },
      { key: 'docx', icon: 'article', label: 'Word', onClick: () => onExport('docx') },
    ];
  }, [onExport, isDone]);

  const allExportItems = useMemo<DropdownItem[] | null>(() => {
    if (!onExportAll || !isDone || totalImages <= 1 || hasPendingPages) return null;
    return [
      { key: 'md', icon: 'description', label: 'Markdown', onClick: () => onExportAll('md') },
      { key: 'txt', icon: 'text_snippet', label: 'Text', onClick: () => onExportAll('txt') },
      { key: 'docx', icon: 'article', label: 'Word', onClick: () => onExportAll('docx') },
    ];
  }, [onExportAll, isDone, totalImages, hasPendingPages]);

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
            <span>{t('result.recognizing')}</span>
          </div>
        )}
        {hasResult && (
          <div key={currentIndex} className="result-text result-text--enter">
            <div className="result-header">
              <div className="result-header__info" aria-hidden="true">
                <span className="material-icons-round">description</span>
                <span>{t('result.pageResult', { index: currentIndex + 1 })}</span>
              </div>
              <div className="result-header__actions">
                <ButtonWithDropdown
                  label={t('result.copy')}
                  icon="content_copy"
                  onClick={onCopy}
                  dropdownItems={singleExportItems}
                />
                {totalImages > 1 && (
                  <ButtonWithDropdown
                    label={t('result.copyAll')}
                    icon="copy_all"
                    onClick={onCopyAll}
                    dropdownItems={allExportItems}
                  />
                )}
              </div>
            </div>
            <div className="result-body">
              {isStreaming ? (
                <div className="streaming-text is-streaming">
                  {lines.map((line, index) => (
                    <TextLine key={`${currentIndex}-${index}`} line={line} index={index} isStreaming={isStreaming} />
                  ))}
                </div>
              ) : (
                <MarkdownResult content={result} />
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
