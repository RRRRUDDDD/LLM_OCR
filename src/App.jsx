import { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';

import useSnackbar from './hooks/useSnackbar';
import useImageManager from './hooks/useImageManager';
import useOcrApi from './hooks/useOcrApi';

import UploadZone from './components/UploadZone';
import ImagePreview from './components/ImagePreview';
import ResultPanel from './components/ResultPanel';
import SettingsDialog, { DEFAULT_API_CONFIG } from './components/SettingsDialog';
import ImageModal from './components/ImageModal';

function App() {
  // API config — persisted in localStorage
  const [apiConfig, setApiConfig] = useState(() => {
    try {
      const saved = localStorage.getItem('ocr-api-config');
      if (saved) return { ...DEFAULT_API_CONFIG, ...JSON.parse(saved) };
    } catch { /* ignore */ }
    return DEFAULT_API_CONFIG;
  });

  const [showSettings, setShowSettings] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [pastedUrl, setPastedUrl] = useState('');

  const { visible: snackbarVisible, message: snackbarMessage, type: snackbarType, show: showSnack, dismiss: dismissSnack } = useSnackbar();
  const {
    images, currentIndex, canGoPrev, canGoNext,
    addImages, addSingleImage, prevImage, nextImage, goTo, clearAll,
  } = useImageManager();
  const {
    results, isLoading, ensureResultSlots,
    processFile, processFiles, clearResults,
  } = useOcrApi(apiConfig);

  // Refs for latest values — used by paste handler to avoid stale closures
  const handleSingleFileRef = useRef(null);

  // Auto-open settings if no API key
  useEffect(() => {
    if (!apiConfig.apiKey) setShowSettings(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Escape to close dialogs + lock background scroll
  useEffect(() => {
    const anyDialogOpen = showModal || showSettings;
    if (!anyDialogOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
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

  // Arrow-key navigation between images (only when no dialog is open)
  useEffect(() => {
    if (images.length <= 1 || showModal || showSettings) return;

    const handleArrowKey = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.key === 'ArrowLeft' && canGoPrev) {
        e.preventDefault();
        prevImage();
      } else if (e.key === 'ArrowRight' && canGoNext) {
        e.preventDefault();
        nextImage();
      }
    };

    document.addEventListener('keydown', handleArrowKey);
    return () => document.removeEventListener('keydown', handleArrowKey);
  }, [images.length, showModal, showSettings, canGoPrev, canGoNext, prevImage, nextImage]);

  // Process a single file (paste, URL)
  // Uses countRef return from addSingleImage — no stale closure on images.length
  const handleSingleFile = useCallback(async (file) => {
    if (!apiConfig.apiKey) {
      setShowSettings(true);
      showSnack('请先配置 API 密钥', 'error');
      return;
    }
    try {
      const newIndex = addSingleImage(file);
      ensureResultSlots(newIndex + 1);
      goTo(newIndex);
      await processFile(file, newIndex);
    } catch (error) {
      console.error('Error processing file:', error);
    }
  }, [apiConfig.apiKey, addSingleImage, ensureResultSlots, goTo, processFile, showSnack]);

  // Keep ref in sync for paste handler
  handleSingleFileRef.current = handleSingleFile;

  // Paste handler — uses ref to always call latest handleSingleFile
  useEffect(() => {
    const handlePaste = async (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      e.preventDefault();
      const items = Array.from(e.clipboardData.items);

      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            handleSingleFileRef.current(file);
          }
        } else if (item.type === 'text/plain') {
          item.getAsString((text) => {
            if (text.match(/https?:\/\//i)) {
              setPastedUrl(text);
            }
          });
        }
      }
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, []); // Stable — uses ref for latest callback

  // Process multiple files (upload, drag & drop)
  const handleMultipleFiles = useCallback(async (files) => {
    if (!apiConfig.apiKey) {
      setShowSettings(true);
      showSnack('请先配置 API 密钥', 'error');
      return;
    }
    try {
      const startIndex = addImages(files);
      ensureResultSlots(startIndex + files.length);
      goTo(startIndex);
      await processFiles(files, startIndex);
    } catch (error) {
      console.error('Error processing files:', error);
    }
  }, [apiConfig.apiKey, addImages, ensureResultSlots, goTo, processFiles, showSnack]);

  // Save settings — only persist non-default values to allow code-side prompt updates
  const handleSaveSettings = useCallback((config) => {
    setApiConfig(config);
    const toStore = { ...config };
    if (toStore.prompt === DEFAULT_API_CONFIG.prompt) delete toStore.prompt;
    if (toStore.baseUrl === DEFAULT_API_CONFIG.baseUrl) delete toStore.baseUrl;
    if (toStore.model === DEFAULT_API_CONFIG.model) delete toStore.model;
    localStorage.setItem('ocr-api-config', JSON.stringify(toStore));
    setShowSettings(false);
    showSnack('配置已保存');
  }, [showSnack]);

  // Copy result
  const handleCopyText = useCallback(() => {
    if (results[currentIndex]) {
      navigator.clipboard.writeText(results[currentIndex])
        .then(() => showSnack('已复制到剪贴板'))
        .catch((err) => console.error('复制失败:', err));
    }
  }, [results, currentIndex, showSnack]);

  const clearPastedUrl = useCallback(() => setPastedUrl(''), []);
  const openSettings = useCallback(() => setShowSettings(true), []);
  const closeSettings = useCallback(() => setShowSettings(false), []);
  const openModal = useCallback(() => setShowModal(true), []);
  const closeModal = useCallback(() => setShowModal(false), []);

  // Clear both images and results together
  const handleClearAll = useCallback(() => {
    clearAll();
    clearResults();
  }, [clearAll, clearResults]);

  return (
    <div className="md-app">
      {/* Top App Bar */}
      <header className="md-top-app-bar">
        <div className="md-top-app-bar__row">
          <span className="material-icons-round md-top-app-bar__nav-icon">document_scanner</span>
          <h1 className="md-top-app-bar__title">LLM OCR</h1>
          <button
            className={`md-icon-button ${!apiConfig.apiKey ? 'md-icon-button--badge' : ''}`}
            onClick={openSettings}
            aria-label="设置"
          >
            <span className="material-icons-round">settings</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className={`md-main ${images.length > 0 ? 'has-content' : ''}`}>
        {images.length === 0 && (
          <p className="hero-subtitle">上传或拖拽图片即刻识别文字内容</p>
        )}

        {/* Upload card wraps both UploadZone and ImagePreview — matches original layout */}
        <section className={`upload-card md-card md-elevation-1 ${images.length > 0 ? 'with-image' : ''}`}>
          <UploadZone
            hasImages={images.length > 0}
            onFilesSelected={handleMultipleFiles}
            onUrlSubmit={handleSingleFile}
            showSnack={showSnack}
            pastedUrl={pastedUrl}
            onPastedUrlConsumed={clearPastedUrl}
          />

          {images.length > 0 && (
            <ImagePreview
              images={images}
              currentIndex={currentIndex}
              isLoading={isLoading}
              canGoPrev={canGoPrev}
              canGoNext={canGoNext}
              onPrev={prevImage}
              onNext={nextImage}
              onClick={openModal}
              onClear={handleClearAll}
            />
          )}
        </section>

        <ResultPanel
          result={results[currentIndex] || ''}
          isLoading={isLoading}
          currentIndex={currentIndex}
          onCopy={handleCopyText}
        />
      </main>

      {/* Modals */}
      <ImageModal
        isOpen={showModal}
        imageSrc={images[currentIndex]}
        onClose={closeModal}
      />

      <SettingsDialog
        isOpen={showSettings}
        apiConfig={apiConfig}
        onSave={handleSaveSettings}
        onClose={closeSettings}
      />

      {/* Snackbar */}
      {snackbarVisible && (
        <div className={`md-snackbar md-elevation-3 ${snackbarType === 'error' ? 'md-snackbar--error' : ''}`} role="status" aria-live="polite">
          <span className="material-icons-round">
            {snackbarType === 'error' ? 'error' : 'check_circle'}
          </span>
          <span className="md-snackbar__text">{snackbarMessage}</span>
          <button className="md-icon-button md-snackbar__dismiss" onClick={dismissSnack} aria-label="Dismiss">
            <span className="material-icons-round">close</span>
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
