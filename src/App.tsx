import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import './App.css';
import './components/NewComponents.css';

import { usePages, PAGE_STATUS } from './stores/pagesStore';
import { queueOcrTask } from './services/ocrService';
import { queueManager } from './services/queueManager';
import { fileAdditionQueue } from './utils/fileAdditionQueue';
import { uiLogger } from './utils/logger';
import { inferProviderFromConfig, type ApiConfig } from './types/api';
import type { PageStatus } from './types/page';
import type { ExportFormat } from './types/ui';

const lazyPdf = () => import('./services/pdfService');
const lazyExport = () => import('./services/exportService');
const lazyDocx = () => import('./services/docxService');

import useSnackbar from './hooks/useSnackbar';
import UploadZone from './components/UploadZone';
import ImagePreview from './components/ImagePreview';
import ResultPanel from './components/ResultPanel';
import SettingsDialog, { DEFAULT_API_CONFIG } from './components/SettingsDialog';
import ImageModal from './components/ImageModal';
import PageThumbnail from './components/PageThumbnail';

type ThemeMode = 'light' | 'dark';

function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

function App() {
  const { t } = useTranslation();
  const {
    pages, currentPage, currentIndex, selectedPageId,
    canGoPrev, canGoNext, totalPages, processingCount,
    addPage, clearAll,
    selectPage, loadFromDB, syncVisibleImages,
    prevPage, nextPage,
  } = usePages();

  const [apiConfig, setApiConfig] = useState<ApiConfig>(() => {
    try {
      const saved = localStorage.getItem('ocr-api-config');
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<ApiConfig>;
        return {
          ...DEFAULT_API_CONFIG,
          ...parsed,
          provider: inferProviderFromConfig(parsed),
        };
      }
    } catch {
      // ignore corrupted local storage
    }
    return DEFAULT_API_CONFIG;
  });

  const [showSettings, setShowSettings] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [pastedUrl, setPastedUrl] = useState('');

  const [theme, setTheme] = useState<ThemeMode>(() => {
    try {
      const saved = localStorage.getItem('ocr-theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {
      // ignore local storage failures
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('ocr-theme', theme);
    } catch {
      // ignore local storage failures
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((currentTheme) => (currentTheme === 'dark' ? 'light' : 'dark'));
  }, []);

  const { visible: snackbarVisible, message: snackbarMessage, type: snackbarType, show: showSnack, dismiss: dismissSnack } = useSnackbar();

  const apiConfigRef = useRef<ApiConfig>(apiConfig);
  useEffect(() => {
    apiConfigRef.current = apiConfig;
  }, [apiConfig]);

  useEffect(() => {
    loadFromDB();
  }, [loadFromDB]);

  useEffect(() => {
    if (!apiConfig.apiKey) setShowSettings(true);
  }, [apiConfig.apiKey]);

  useEffect(() => {
    const anyDialogOpen = showModal || showSettings;
    if (!anyDialogOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (showSettings) setShowSettings(false);
        else if (showModal) setShowModal(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [showModal, showSettings]);

  useEffect(() => {
    if (totalPages <= 1 || showModal || showSettings) return;

    const handleArrowKey = (event: KeyboardEvent) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (event.key === 'ArrowLeft' && canGoPrev) {
        event.preventDefault();
        prevPage();
      } else if (event.key === 'ArrowRight' && canGoNext) {
        event.preventDefault();
        nextPage();
      }
    };

    document.addEventListener('keydown', handleArrowKey);
    return () => document.removeEventListener('keydown', handleArrowKey);
  }, [totalPages, showModal, showSettings, canGoPrev, canGoNext, prevPage, nextPage]);

  const checkApiKey = useCallback((): boolean => {
    if (!apiConfig.apiKey) {
      setShowSettings(true);
      showSnack(t('settings.apiKeyRequired'), 'error');
      return false;
    }
    return true;
  }, [apiConfig.apiKey, showSnack, t]);

  const handlePdfFile = useCallback(async (file: File, shouldSelectFirstPage: boolean): Promise<boolean> => {
    if (apiConfigRef.current.provider === 'deepseek_ocr_api') {
      const page = await addPage(file);
      if (shouldSelectFirstPage) {
        selectPage(page.id);
      }
      queueOcrTask(page.id, file, apiConfigRef.current);
      return shouldSelectFirstPage;
    }

    const { extractPdfPages } = await lazyPdf();
    let selectedAnyPage = false;

    await extractPdfPages(file, {
      onPage: async (pdfPage) => {
        const pageFile = new File([pdfPage.blob], `${pdfPage.fileName}.png`, { type: 'image/png' });
        const page = await addPage(pageFile);

        if (shouldSelectFirstPage && !selectedAnyPage) {
          selectPage(page.id);
          selectedAnyPage = true;
        }

        queueOcrTask(page.id, pageFile, apiConfigRef.current);
      },
    });

    return selectedAnyPage;
  }, [addPage, selectPage]);

  const handleSingleFile = useCallback(async (file: File): Promise<void> => {
    if (!checkApiKey()) return;

    await fileAdditionQueue.enqueue(async () => {
      try {
        if (isPdfFile(file)) {
          await handlePdfFile(file, true);
        } else {
          const page = await addPage(file);
          selectPage(page.id);
          queueOcrTask(page.id, file, apiConfigRef.current);
        }
      } catch (error: unknown) {
        uiLogger.error('Error processing file:', error);
        showSnack(error instanceof Error ? error.message : 'Failed to process file', 'error');
      }
    });
  }, [checkApiKey, addPage, selectPage, showSnack]);

  const handleSingleFileRef = useRef(handleSingleFile);
  useEffect(() => {
    handleSingleFileRef.current = handleSingleFile;
  }, [handleSingleFile]);

  useEffect(() => {
    const handlePaste = async (event: ClipboardEvent) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      event.preventDefault();
      const items = Array.from(event.clipboardData?.items ?? []);

      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            await handleSingleFileRef.current(file);
          }
        } else if (item.type === 'text/plain') {
          item.getAsString((text) => {
            if (/https?:\/\//i.test(text)) setPastedUrl(text);
          });
        }
      }
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, []);

  const handleMultipleFiles = useCallback(async (files: File[]): Promise<void> => {
    if (!checkApiKey()) return;

    await fileAdditionQueue.enqueue(async () => {
      try {
        let firstPageSelected = false;
        for (const file of files) {
          if (isPdfFile(file)) {
            const selectedFromPdf = await handlePdfFile(file, !firstPageSelected);
            firstPageSelected = firstPageSelected || selectedFromPdf;
          } else {
            const page = await addPage(file);
            if (!firstPageSelected) {
              selectPage(page.id);
              firstPageSelected = true;
            }
            queueOcrTask(page.id, file, apiConfigRef.current);
          }
        }
      } catch (error: unknown) {
        uiLogger.error('Error processing files:', error);
        showSnack(error instanceof Error ? error.message : 'Failed to process files', 'error');
      }
    });
  }, [checkApiKey, addPage, handlePdfFile, selectPage, showSnack]);

  const handleSaveSettings = useCallback((config: ApiConfig): void => {
    setApiConfig(config);
    const toStore: Partial<ApiConfig> & Pick<ApiConfig, 'apiKey'> = { ...config };
    if (toStore.provider === DEFAULT_API_CONFIG.provider) delete toStore.provider;
    if (toStore.prompt === DEFAULT_API_CONFIG.prompt) delete toStore.prompt;
    if (toStore.baseUrl === DEFAULT_API_CONFIG.baseUrl) delete toStore.baseUrl;
    if (toStore.model === DEFAULT_API_CONFIG.model) delete toStore.model;
    if (toStore.ocrLanguage === DEFAULT_API_CONFIG.ocrLanguage) delete toStore.ocrLanguage;
    localStorage.setItem('ocr-api-config', JSON.stringify(toStore));
    setShowSettings(false);
    showSnack(t('settings.saved'));
  }, [showSnack, t]);

  const handleCopyText = useCallback((): void => {
    if (currentPage?.ocrText) {
      navigator.clipboard.writeText(currentPage.ocrText)
        .then(() => showSnack(t('result.copied')))
        .catch(() => showSnack(t('result.copyFailed'), 'error'));
    }
  }, [currentPage, showSnack, t]);

  const handleCopyAll = useCallback((): void => {
    if (processingCount > 0) {
      showSnack(t('result.pendingWarning', { count: processingCount }), 'error');
      return;
    }
    const allText = pages
      .map((page, index) => `--- ${t('result.title', { index: index + 1 })} ---\n${page.ocrText || ''}`)
      .join('\n\n');

    navigator.clipboard.writeText(allText)
      .then(() => showSnack(t('result.copiedAll', { count: totalPages })))
      .catch(() => showSnack(t('result.copyFailed'), 'error'));
  }, [pages, totalPages, processingCount, showSnack, t]);

  const handleExport = useCallback(async (format: ExportFormat): Promise<void> => {
    if (!currentPage) return;
    if (format === 'md') {
      const { exportPageAsMarkdown } = await lazyExport();
      exportPageAsMarkdown(currentPage);
    } else if (format === 'txt') {
      const { exportPageAsText } = await lazyExport();
      exportPageAsText(currentPage);
    } else if (format === 'docx') {
      const { exportPageAsDocx } = await lazyDocx();
      await exportPageAsDocx(currentPage);
    }
  }, [currentPage]);

  const handleExportAll = useCallback(async (format: ExportFormat): Promise<void> => {
    if (processingCount > 0) {
      showSnack(t('result.pendingWarning', { count: processingCount }), 'error');
      return;
    }

    if (format === 'md') {
      const { exportAllAsMarkdown } = await lazyExport();
      exportAllAsMarkdown(pages);
    } else if (format === 'txt') {
      const { exportAllAsText } = await lazyExport();
      exportAllAsText(pages);
    } else if (format === 'docx') {
      const { exportAllAsDocx } = await lazyDocx();
      await exportAllAsDocx(pages);
    }
  }, [pages, processingCount, showSnack, t]);

  const handleCancelOcr = useCallback((pageId: string): void => {
    queueManager.cancel(pageId);
  }, []);

  const handleClearAll = useCallback((): void => {
    queueManager.cancelAll();
    void clearAll();
  }, [clearAll]);

  const currentResult = currentPage?.ocrText || '';
  const isLoading = currentPage?.status === PAGE_STATUS.PROCESSING;
  const currentStatus: PageStatus = currentPage?.status || PAGE_STATUS.IDLE;
  const currentImageSrc = currentPage?.imageUrl || '';

  useEffect(() => {
    if (currentIndex < 0) return;

    const windowStart = Math.max(0, currentIndex - 3);
    const windowEnd = Math.min(pages.length, currentIndex + 4);
    const visiblePageIds = pages
      .slice(windowStart, windowEnd)
      .filter((page) => page.fileType.startsWith('image/'))
      .map((page) => page.id);
    void syncVisibleImages(visiblePageIds);
  }, [currentIndex, pages, syncVisibleImages]);

  return (
    <div className="md-app">
      <header className="md-top-app-bar">
        <div className="md-top-app-bar__row">
          <span className="material-icons-round md-top-app-bar__nav-icon">document_scanner</span>
          <h1 className="md-top-app-bar__title">LLM OCR</h1>

          <a
            className="md-icon-button"
            href="https://github.com/RRRRUDDDD/LLM_OCR"
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('app.github')}
          >
            <svg className="github-icon" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
              <path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.868-.013-1.703-2.782.603-3.369-1.342-3.369-1.342-.454-1.154-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836a9.59 9.59 0 0 1 2.504.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.202 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
            </svg>
          </a>
          <button
            className="md-icon-button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? t('app.toggleLightMode') : t('app.toggleDarkMode')}
          >
            <span className="material-icons-round">{theme === 'dark' ? 'light_mode' : 'dark_mode'}</span>
          </button>
          <button
            className={`md-icon-button ${!apiConfig.apiKey ? 'md-icon-button--badge' : ''}`}
            onClick={() => setShowSettings(true)}
            aria-label={t('app.settings')}
          >
            <span className="material-icons-round">settings</span>
          </button>
        </div>
      </header>

      <main className={`md-main ${totalPages > 0 ? 'has-content' : ''}`}>
        {totalPages === 0 && (
          <p className="hero-subtitle">{t('app.heroSubtitle')}</p>
        )}

        <section className={`upload-card md-card md-elevation-1 ${totalPages > 0 ? 'with-image' : ''}`}>
          <UploadZone
            hasImages={totalPages > 0}
            onFilesSelected={handleMultipleFiles}
            onUrlSubmit={handleSingleFile}
            showSnack={showSnack}
            pastedUrl={pastedUrl}
            onPastedUrlConsumed={() => setPastedUrl('')}
          />

          {totalPages > 0 && (
            <>
              {totalPages > 1 && (
                <div className="page-thumbnails-strip" role="listbox" aria-label="Pages">
                  {pages.map((page) => (
                    <PageThumbnail
                      key={page.id}
                      page={page}
                      isSelected={page.id === selectedPageId}
                      onClick={(selectedPage) => selectPage(selectedPage.id)}
                      onCancel={handleCancelOcr}
                    />
                  ))}
                </div>
              )}

              <ImagePreview
                imageSrc={currentImageSrc}
                fileType={currentPage?.fileType}
                fileName={currentPage?.fileName}
                totalImages={totalPages}
                currentIndex={currentIndex >= 0 ? currentIndex : 0}
                isLoading={isLoading}
                canGoPrev={canGoPrev}
                canGoNext={canGoNext}
                onPrev={prevPage}
                onNext={nextPage}
                onClick={() => {
                  if (currentImageSrc) setShowModal(true);
                }}
                onClear={handleClearAll}
              />
            </>
          )}
        </section>

        <ResultPanel
          result={currentResult}
          isLoading={isLoading}
          currentIndex={currentIndex >= 0 ? currentIndex : 0}
          totalImages={totalPages}
          hasPendingPages={processingCount > 0}
          onCopy={handleCopyText}
          onCopyAll={handleCopyAll}
          status={currentStatus}
          onExport={handleExport}
          onExportAll={handleExportAll}
        />
      </main>

      <ImageModal
        isOpen={showModal}
        imageSrc={currentPage?.imageUrl || ''}
        onClose={() => setShowModal(false)}
      />

      <SettingsDialog
        isOpen={showSettings}
        apiConfig={apiConfig}
        onSave={handleSaveSettings}
        onClose={() => setShowSettings(false)}
      />

      {snackbarVisible && (
        <div
          className={`md-snackbar md-elevation-3 ${snackbarType === 'error' ? 'md-snackbar--error' : ''}`}
          role={snackbarType === 'error' ? 'alert' : 'status'}
          aria-live={snackbarType === 'error' ? 'assertive' : 'polite'}
          aria-atomic="true"
        >
          <span className="material-icons-round" aria-hidden="true">
            {snackbarType === 'error' ? 'error' : 'check_circle'}
          </span>
          <span className="md-snackbar__text">{snackbarMessage}</span>
          <button className="md-icon-button md-snackbar__dismiss" onClick={dismissSnack} aria-label="Close">
            <span className="material-icons-round" aria-hidden="true">close</span>
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
