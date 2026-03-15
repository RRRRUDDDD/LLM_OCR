import { useState, useRef, useEffect, useCallback } from 'react';
import fetchImageFromUrl from '../utils/fetchImageFromUrl';

/**
 * Upload zone — drag & drop, file input, URL input.
 * Renders only the inner upload-zone div (no section wrapper).
 * The parent wraps it in upload-card section together with ImagePreview.
 */
export default function UploadZone({
  hasImages,
  onFilesSelected,
  onUrlSubmit,
  showSnack,
  pastedUrl,
  onPastedUrlConsumed,
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [imageUrl, setImageUrl] = useState('');
  const dropZoneRef = useRef(null);
  // Use ref instead of state to avoid re-registering window listeners on drag
  const isDraggingGlobalRef = useRef(false);

  // Restore paste-URL auto-fill: when App.js detects a pasted URL, pre-fill and show
  useEffect(() => {
    if (pastedUrl) {
      setImageUrl(pastedUrl);
      setShowUrlInput(true);
      onPastedUrlConsumed();
    }
  }, [pastedUrl, onPastedUrlConsumed]);

  // Global drag tracking — uses ref to keep deps stable (no re-registration)
  useEffect(() => {
    const handleGlobalDragEnter = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isDraggingGlobalRef.current) {
        isDraggingGlobalRef.current = true;
        setIsDragging(true);
      }
    };

    const handleGlobalDragLeave = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = document.body.getBoundingClientRect();
      if (e.clientX <= rect.left || e.clientX >= rect.right || e.clientY <= rect.top || e.clientY >= rect.bottom) {
        isDraggingGlobalRef.current = false;
        setIsDragging(false);
      }
    };

    const handleGlobalDrop = (e) => {
      e.preventDefault();
      e.stopPropagation();
      isDraggingGlobalRef.current = false;
      setIsDragging(false);
    };

    const preventDragDefault = (e) => e.preventDefault();

    window.addEventListener('dragenter', handleGlobalDragEnter);
    window.addEventListener('dragleave', handleGlobalDragLeave);
    window.addEventListener('drop', handleGlobalDrop);
    window.addEventListener('dragover', preventDragDefault);

    return () => {
      window.removeEventListener('dragenter', handleGlobalDragEnter);
      window.removeEventListener('dragleave', handleGlobalDragLeave);
      window.removeEventListener('drop', handleGlobalDrop);
      window.removeEventListener('dragover', preventDragDefault);
    };
  }, []); // Stable — no state dependency

  const handleDragEnter = useCallback((e) => { e.preventDefault(); e.stopPropagation(); }, []);
  const handleDragOver = useCallback((e) => { e.preventDefault(); e.stopPropagation(); }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!dropZoneRef.current) return;
    const rect = dropZoneRef.current.getBoundingClientRect();
    if (e.clientX <= rect.left || e.clientX >= rect.right || e.clientY <= rect.top || e.clientY >= rect.bottom) {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    isDraggingGlobalRef.current = false;

    const items = Array.from(e.dataTransfer.items);
    const filePromises = items.map(async (item) => {
      if (item.kind === 'string') {
        const url = await new Promise((resolve) => item.getAsString(resolve));
        if (url.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
          try {
            const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
            if (!response.ok) return null;
            const blob = await response.blob();
            return new File([blob], 'image.jpg', { type: blob.type });
          } catch {
            // Silently skip unreachable URLs in drag & drop
            return null;
          }
        }
      } else if (item.kind === 'file') {
        return item.getAsFile();
      }
      return null;
    });

    const files = (await Promise.all(filePromises)).filter(Boolean);
    if (files.length > 0) onFilesSelected(files);
  }, [onFilesSelected]);

  const handleFileInput = useCallback((e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0) onFilesSelected(files);
    // Reset value so re-selecting the same file triggers onChange again
    e.target.value = '';
  }, [onFilesSelected]);

  const handleUrlSubmit = useCallback(async (e) => {
    e.preventDefault();
    if (!imageUrl) return;

    try {
      const file = await fetchImageFromUrl(imageUrl);
      onUrlSubmit(file);
      setShowUrlInput(false);
      setImageUrl('');
    } catch (error) {
      console.error('Error loading image:', error);
      let msg = '无法加载图片，';
      if (error.name === 'AbortError') msg += '请求超时，请检查网络连接。';
      else if (error.message.includes('CORS')) msg += '该图片可能有访问限制。';
      else if (error.message.includes('network')) msg += '网络连接出现问题。';
      else msg += '请检查链接是否正确。';
      msg += ' 可尝试右键另存为后上传。';
      showSnack(msg, 'error');
    }
  }, [imageUrl, onUrlSubmit, showSnack]);

  return (
    <div
      ref={dropZoneRef}
      className={`upload-zone ${isDragging ? 'dragging' : ''}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {!hasImages && !showUrlInput && (
        <div className="upload-zone__empty">
          <div className="upload-zone__icon-wrapper">
            <span className="material-icons-round">cloud_upload</span>
          </div>
          <p className="upload-zone__title">拖拽或粘贴图片到此处</p>
          <p className="upload-zone__subtitle">支持 JPG / PNG / GIF / WebP 格式</p>
        </div>
      )}

      <div className="upload-actions">
        <label className="md-button md-button--filled" htmlFor="file-input">
          <span className="material-icons-round">upload_file</span>
          <span>{hasImages ? '重新上传' : '上传图片'}</span>
        </label>
        <input id="file-input" type="file" accept="image/*" onChange={handleFileInput} multiple hidden />
        <button className="md-button md-button--outlined" onClick={() => setShowUrlInput(!showUrlInput)}>
          <span className="material-icons-round">link</span>
          <span>{showUrlInput ? '取消' : '使用链接'}</span>
        </button>
      </div>

      {showUrlInput && (
        <form onSubmit={handleUrlSubmit} className="url-form">
          <div className="md-text-field">
            <input
              type="url"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder=" "
              className="md-text-field__input"
              id="url-input"
            />
            <label htmlFor="url-input" className="md-text-field__label">请输入图片链接</label>
          </div>
          <button type="submit" className="md-button md-button--filled">
            <span className="material-icons-round">send</span>
            <span>确认</span>
          </button>
        </form>
      )}
    </div>
  );
}
