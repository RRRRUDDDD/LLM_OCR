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
import { STATUS_PROCESSING } from './hooks/useOcrApi';

function App() {
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

  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('ocr-theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch { /* ignore */ }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('ocr-theme', theme); } catch { /* ignore */ }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  }, []);

  const { visible: snackbarVisible, message: snackbarMessage, type: snackbarType, show: showSnack, dismiss: dismissSnack } = useSnackbar();
  const {
    images, currentIndex, canGoPrev, canGoNext,
    addImages, addSingleImage, prevImage, nextImage, goTo, clearAll,
  } = useImageManager();
  const {
    results, statuses, isLoading, ensureResultSlots,
    processFile, processFiles, clearResults, cancelAll,
  } = useOcrApi(apiConfig);

  const handleSingleFileRef = useRef(null);

  useEffect(() => {
    if (!apiConfig.apiKey) setShowSettings(true);
  }, []); 

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

  const checkApiKey = useCallback(() => {
    if (!apiConfig.apiKey) {
      setShowSettings(true);
      showSnack('请先配置 API 密钥', 'error');
      return false;
    }
    return true;
  }, [apiConfig.apiKey, showSnack]);

  const handleSingleFile = useCallback(async (file) => {
    if (!checkApiKey()) return;
    try {
      const newIndex = addSingleImage(file);
      ensureResultSlots(newIndex + 1);
      goTo(newIndex);
      await processFile(file, newIndex);
    } catch (error) {
      console.error('Error processing file:', error);
    }
  }, [checkApiKey, addSingleImage, ensureResultSlots, goTo, processFile]);

  handleSingleFileRef.current = handleSingleFile;

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
  }, []); 

  const handleMultipleFiles = useCallback(async (files) => {
    if (!checkApiKey()) return;
    try {
      const startIndex = addImages(files);
      ensureResultSlots(startIndex + files.length);
      goTo(startIndex);
      await processFiles(files, startIndex);
    } catch (error) {
      console.error('Error processing files:', error);
    }
  }, [checkApiKey, addImages, ensureResultSlots, goTo, processFiles]);

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

  const handleCopyText = useCallback(() => {
    if (results[currentIndex]) {
      navigator.clipboard.writeText(results[currentIndex])
        .then(() => showSnack('已复制到剪贴板'))
        .catch(() => showSnack('复制失败，请手动复制', 'error'));
    }
  }, [results, currentIndex, showSnack]);

  const handleCopyAll = useCallback(() => {
    const totalImages = images.length;
    const pendingCount = statuses.slice(0, totalImages).filter((s) => s === STATUS_PROCESSING).length;
    if (isLoading || pendingCount > 0) {
      showSnack(`还有 ${Math.max(pendingCount, 1)} 张图片正在识别中，请稍等`, 'error');
      return;
    }

    const allText = results
      .slice(0, totalImages)
      .map((text, i) => `--- 第 ${i + 1} 张 ---\n${text}`)
      .join('\n\n');

    navigator.clipboard.writeText(allText)
      .then(() => showSnack(`已复制全部 ${totalImages} 张图片的识别结果`))
      .catch(() => showSnack('复制失败，请手动复制', 'error'));
  }, [images.length, statuses, results, isLoading, showSnack]);

  const clearPastedUrl = useCallback(() => setPastedUrl(''), []);
  const openSettings = useCallback(() => setShowSettings(true), []);
  const closeSettings = useCallback(() => setShowSettings(false), []);
  const openModal = useCallback(() => setShowModal(true), []);
  const closeModal = useCallback(() => setShowModal(false), []);

  const handleClearAll = useCallback(() => {
    cancelAll();
    clearAll();
    clearResults();
  }, [cancelAll, clearAll, clearResults]);

  return (
    <div className="md-app">
      {/* 顶部应用栏 */}
      <header className="md-top-app-bar">
        <div className="md-top-app-bar__row">
          <span className="material-icons-round md-top-app-bar__nav-icon">document_scanner</span>
          <h1 className="md-top-app-bar__title">LLM OCR</h1>
          <a
            className="md-icon-button"
            href="https://github.com/RRRRUDDDD/LLM_OCR"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub 仓库"
          >
            <svg className="github-icon" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
              <path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.868-.013-1.703-2.782.603-3.369-1.342-3.369-1.342-.454-1.154-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836a9.59 9.59 0 0 1 2.504.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.202 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z"/>
            </svg>
          </a>
          <button
            className="md-icon-button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? '切换到亮色模式' : '切换到暗色模式'}
          >
            <span className="material-icons-round">{theme === 'dark' ? 'light_mode' : 'dark_mode'}</span>
          </button>
          <button
            className={`md-icon-button ${!apiConfig.apiKey ? 'md-icon-button--badge' : ''}`}
            onClick={openSettings}
            aria-label="设置"
          >
            <span className="material-icons-round">settings</span>
          </button>
        </div>
      </header>

      {/* 主内容区 */}
      <main className={`md-main ${images.length > 0 ? 'has-content' : ''}`}>
        {images.length === 0 && (
          <p className="hero-subtitle">上传或拖拽图片即刻识别文字内容</p>
        )}

        {/* UploadZone 和 ImagePreview */}
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
          totalImages={images.length}
          onCopy={handleCopyText}
          onCopyAll={handleCopyAll}
          status={statuses[currentIndex]}
        />
      </main>

      {/* 弹窗 */}
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

      {/* 提示条 */}
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
          <button className="md-icon-button md-snackbar__dismiss" onClick={dismissSnack} aria-label="关闭提示">
            <span className="material-icons-round" aria-hidden="true">close</span>
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
