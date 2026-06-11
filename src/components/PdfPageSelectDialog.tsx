import { useState, useEffect, useRef, useCallback, useMemo, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import useFocusTrap from '../hooks/useFocusTrap';
import { parsePageRange } from '../utils/parsePageRange';
import { uiLogger } from '../utils/logger';
import type { PdfRenderSource } from '../services/pdfService';

interface ThumbnailItem {
  pageNumber: number;
  url: string;
}

interface PdfPageSelectDialogProps {
  file: File;
  onConfirm: (pageNumbers: number[]) => void;
  onCancel: () => void;
}

// Selection-grid thumbnails: small and fast, quality matters little.
const THUMBNAIL_TARGET_WIDTH = 160;
// Large preview: readable text without rendering the full OCR-grade image.
const PREVIEW_TARGET_WIDTH = 1100;
// Keep a handful of rendered previews around so flipping back is instant.
const PREVIEW_CACHE_SIZE = 8;
// Flush streamed thumbnails into state in batches — one setState per page
// would re-render the whole grid hundreds of times on large PDFs.
const THUMBNAIL_FLUSH_BATCH = 12;

function isEditableTarget(target: EventTarget | null): boolean {
  const tag = target instanceof HTMLElement ? target.tagName : '';
  return tag === 'INPUT' || tag === 'TEXTAREA';
}

/**
 * Page picker shown after a PDF is uploaded: a master-detail layout with a
 * compact thumbnail grid on one side and an always-visible large preview on
 * the other. Clicking a thumbnail toggles its selection and focuses it in
 * the preview; arrow keys page the preview through the document. All pages
 * start selected, so a single click on confirm keeps the old "process
 * everything" behavior.
 */
export default function PdfPageSelectDialog({ file, onConfirm, onCancel }: PdfPageSelectDialogProps) {
  const { t } = useTranslation();
  const [thumbnails, setThumbnails] = useState<ThumbnailItem[]>([]);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [rangeInput, setRangeInput] = useState('');
  const [previewPage, setPreviewPage] = useState<number | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const lastClickedRef = useRef<number | null>(null);
  const sourceRef = useRef<PdfRenderSource | null>(null);
  const previewCacheRef = useRef<Map<number, string>>(new Map());
  const previewRequestRef = useRef(0);
  const trapRef = useFocusTrap<HTMLDivElement>(true);

  const openPreview = useCallback((pageNumber: number) => {
    setPreviewPage(pageNumber);

    const cached = previewCacheRef.current.get(pageNumber);
    if (cached) {
      // Refresh LRU position
      previewCacheRef.current.delete(pageNumber);
      previewCacheRef.current.set(pageNumber, cached);
      setPreviewUrl(cached);
      return;
    }

    setPreviewUrl(null);
    const source = sourceRef.current;
    if (!source) return;

    const requestId = ++previewRequestRef.current;
    void source.renderPage(pageNumber, PREVIEW_TARGET_WIDTH)
      .then(({ blob }) => {
        if (requestId !== previewRequestRef.current) return;
        const url = URL.createObjectURL(blob);
        const cache = previewCacheRef.current;
        cache.set(pageNumber, url);
        while (cache.size > PREVIEW_CACHE_SIZE) {
          const oldest = cache.keys().next().value as number;
          const oldUrl = cache.get(oldest);
          cache.delete(oldest);
          if (oldUrl) URL.revokeObjectURL(oldUrl);
        }
        setPreviewUrl(url);
      })
      .catch((error) => uiLogger.error('PDF preview render failed:', error));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    const previewCache = previewCacheRef.current;

    void (async () => {
      try {
        const { createPdfRenderSource } = await import('../services/pdfService');
        const source = await createPdfRenderSource(file);
        if (cancelled) {
          void source.destroy();
          return;
        }
        sourceRef.current = source;
        setTotalPages(source.totalPages);

        let buffer: ThumbnailItem[] = [];
        const flushBuffer = () => {
          if (buffer.length === 0) return;
          const items = buffer;
          buffer = [];
          setThumbnails((prev) => [...prev, ...items]);
          setSelected((prev) => {
            const next = new Set(prev);
            for (const item of items) next.add(item.pageNumber);
            return next;
          });
        };

        for (let pageNumber = 1; pageNumber <= source.totalPages; pageNumber++) {
          if (cancelled) break;
          const { blob } = await source.renderPage(pageNumber, THUMBNAIL_TARGET_WIDTH);
          if (cancelled) break;
          const url = URL.createObjectURL(blob);
          urls.push(url);
          buffer.push({ pageNumber, url });
          if (buffer.length >= THUMBNAIL_FLUSH_BATCH) flushBuffer();
          // The preview pane is always visible — show the first page as soon
          // as the document is readable.
          if (pageNumber === 1) {
            flushBuffer();
            openPreview(1);
          }
        }
        flushBuffer();
      } catch (error) {
        uiLogger.error('PDF thumbnail extraction failed:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
      for (const url of previewCache.values()) URL.revokeObjectURL(url);
      previewCache.clear();
      void sourceRef.current?.destroy();
      sourceRef.current = null;
    };
  }, [file, openPreview]);

  const stepPreview = useCallback((delta: number) => {
    if (previewPage === null) return;
    const max = totalPages || thumbnails.length || previewPage;
    const next = Math.min(Math.max(previewPage + delta, 1), max);
    if (next !== previewPage) openPreview(next);
  }, [previewPage, totalPages, thumbnails.length, openPreview]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;

      if (event.key === 'Escape') {
        event.stopPropagation();
        onCancel();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault();
        stepPreview(1);
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        stepPreview(-1);
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [onCancel, stepPreview]);

  const applySelection = useCallback((updater: (prev: Set<number>) => Set<number>) => {
    setSelected((prev) => updater(prev));
  }, []);

  const togglePage = useCallback((pageNumber: number) => {
    applySelection((prev) => {
      const next = new Set(prev);
      if (next.has(pageNumber)) next.delete(pageNumber);
      else next.add(pageNumber);
      return next;
    });
  }, [applySelection]);

  const handleThumbnailClick = useCallback((pageNumber: number, shiftKey: boolean) => {
    applySelection((prev) => {
      const next = new Set(prev);
      const willSelect = !prev.has(pageNumber);

      if (shiftKey && lastClickedRef.current !== null) {
        const start = Math.min(lastClickedRef.current, pageNumber);
        const end = Math.max(lastClickedRef.current, pageNumber);
        for (let n = start; n <= end; n++) {
          if (willSelect) next.add(n);
          else next.delete(n);
        }
      } else if (willSelect) {
        next.add(pageNumber);
      } else {
        next.delete(pageNumber);
      }

      return next;
    });
    lastClickedRef.current = pageNumber;
    openPreview(pageNumber);
  }, [applySelection, openPreview]);

  const selectAll = useCallback(() => {
    applySelection(() => new Set(thumbnails.map((thumb) => thumb.pageNumber)));
  }, [applySelection, thumbnails]);

  const selectNone = useCallback(() => {
    applySelection(() => new Set());
  }, [applySelection]);

  const invertSelection = useCallback(() => {
    applySelection((prev) => new Set(thumbnails.map((thumb) => thumb.pageNumber).filter((n) => !prev.has(n))));
  }, [applySelection, thumbnails]);

  const selectParity = useCallback((parity: 0 | 1) => {
    applySelection(() => new Set(thumbnails.map((thumb) => thumb.pageNumber).filter((n) => n % 2 === parity)));
  }, [applySelection, thumbnails]);

  const applyRange = useCallback(() => {
    if (!rangeInput.trim()) return;
    const pages = parsePageRange(rangeInput, totalPages || thumbnails.length);
    applySelection(() => new Set(pages));
  }, [applySelection, rangeInput, totalPages, thumbnails.length]);

  const handleRangeKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      applyRange();
    }
  }, [applyRange]);

  const handleConfirm = useCallback(() => {
    onConfirm(Array.from(selected).sort((a, b) => a - b));
  }, [onConfirm, selected]);

  const selectedCount = selected.size;
  const knownTotal = totalPages || thumbnails.length;
  const previewSelected = previewPage !== null && selected.has(previewPage);

  const batchActions = useMemo(() => ([
    { key: 'all', label: t('pdfSelect.selectAll'), onClick: selectAll },
    { key: 'none', label: t('pdfSelect.selectNone'), onClick: selectNone },
    { key: 'invert', label: t('pdfSelect.invert'), onClick: invertSelection },
    { key: 'odd', label: t('pdfSelect.oddPages'), onClick: () => selectParity(1) },
    { key: 'even', label: t('pdfSelect.evenPages'), onClick: () => selectParity(0) },
  ]), [t, selectAll, selectNone, invertSelection, selectParity]);

  return (
    <div className="md-scrim settings-overlay" onClick={onCancel} role="presentation">
      <div
        ref={trapRef}
        className="pdf-select-dialog md-elevation-5"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pdf-select-title"
      >
        <h2 className="pdf-select-dialog__title" id="pdf-select-title">{t('pdfSelect.title')}</h2>
        <p className="pdf-select-dialog__desc">
          {file.name}
          {knownTotal > 0 && ` · ${t('pdfSelect.selectedCount', { selected: selectedCount, total: knownTotal })}`}
        </p>

        <div className="pdf-select-dialog__toolbar">
          {batchActions.map(({ key, label, onClick }) => (
            <button key={key} type="button" className="md-button md-button--text" onClick={onClick}>
              {label}
            </button>
          ))}
          <input
            type="text"
            className="pdf-select-dialog__range-input"
            value={rangeInput}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setRangeInput(event.target.value)}
            onKeyDown={handleRangeKeyDown}
            placeholder={t('pdfSelect.rangePlaceholder')}
            aria-label={t('pdfSelect.rangePlaceholder')}
          />
          <button type="button" className="md-button md-button--text" onClick={applyRange}>
            {t('pdfSelect.applyRange')}
          </button>
        </div>

        <div className="pdf-select-dialog__content">
          <div className="pdf-select-dialog__grid" role="listbox" aria-multiselectable="true" aria-label={t('pdfSelect.title')}>
            {thumbnails.map(({ pageNumber, url }) => {
              const isSelected = selected.has(pageNumber);
              const isCurrent = pageNumber === previewPage;
              return (
                <button
                  key={pageNumber}
                  type="button"
                  className={`pdf-select-page ${isSelected ? 'pdf-select-page--selected' : ''} ${isCurrent ? 'pdf-select-page--current' : ''}`}
                  role="option"
                  aria-selected={isSelected}
                  aria-current={isCurrent || undefined}
                  onClick={(event) => handleThumbnailClick(pageNumber, event.shiftKey)}
                >
                  <img src={url} alt={`Page ${pageNumber}`} draggable={false} />
                  <span className="pdf-select-page__number">{pageNumber}</span>
                  <span className="pdf-select-page__check material-icons-round" aria-hidden="true">
                    {isSelected ? 'check_circle' : 'radio_button_unchecked'}
                  </span>
                </button>
              );
            })}
            {loading && (
              <div className="pdf-select-dialog__loading" role="status">
                <span className="material-icons-round" aria-hidden="true">hourglass_top</span>
                <span>{t('pdfSelect.loading')}</span>
              </div>
            )}
          </div>

          <div className="pdf-select-preview" role="region" aria-label={t('pdfSelect.previewTitle', { page: previewPage ?? 1, total: knownTotal })}>
            <div className="pdf-select-preview__header">
              <span className="pdf-select-preview__indicator">
                {previewPage !== null && t('pdfSelect.previewTitle', { page: previewPage, total: knownTotal })}
              </span>
              {previewPage !== null && (
                <button
                  type="button"
                  className={`md-button ${previewSelected ? 'md-button--filled' : 'md-button--text'}`}
                  onClick={() => togglePage(previewPage)}
                >
                  <span className="material-icons-round" aria-hidden="true">
                    {previewSelected ? 'check_circle' : 'radio_button_unchecked'}
                  </span>
                  <span>{previewSelected ? t('pdfSelect.deselectPage') : t('pdfSelect.selectPage')}</span>
                </button>
              )}
            </div>

            <div className="pdf-select-preview__body">
              {previewUrl ? (
                <img src={previewUrl} alt={`Page ${previewPage ?? ''}`} draggable={false} />
              ) : (
                <div className="pdf-select-dialog__loading" role="status">
                  <span className="material-icons-round" aria-hidden="true">hourglass_top</span>
                  <span>{t('pdfSelect.loading')}</span>
                </div>
              )}
            </div>

            <div className="pdf-select-preview__nav">
              <button
                type="button"
                className="md-button md-button--text"
                onClick={() => stepPreview(-1)}
                disabled={previewPage === null || previewPage <= 1}
              >
                <span className="material-icons-round" aria-hidden="true">keyboard_arrow_up</span>
                <span>{t('pdfSelect.prevPage')}</span>
              </button>
              <button
                type="button"
                className="md-button md-button--text"
                onClick={() => stepPreview(1)}
                disabled={previewPage === null || (knownTotal > 0 && previewPage >= knownTotal)}
              >
                <span className="material-icons-round" aria-hidden="true">keyboard_arrow_down</span>
                <span>{t('pdfSelect.nextPage')}</span>
              </button>
            </div>
          </div>
        </div>

        <div className="pdf-select-dialog__actions">
          <button type="button" className="md-button md-button--text" onClick={onCancel}>
            {t('pdfSelect.cancel')}
          </button>
          <button
            type="button"
            className="md-button md-button--filled"
            onClick={handleConfirm}
            disabled={loading || selectedCount === 0}
          >
            {t('pdfSelect.confirm', { count: selectedCount })}
          </button>
        </div>
      </div>
    </div>
  );
}
