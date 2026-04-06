import { useState, useRef, useEffect, useCallback, type ChangeEvent, type DragEvent as ReactDragEvent, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import fetchImageFromUrl from '../utils/fetchImageFromUrl';
import { uiLogger } from '../utils/logger';
import type { SnackbarType } from '../types/ui';

interface UploadZoneProps {
  hasImages: boolean;
  onFilesSelected: (files: File[]) => void;
  onUrlSubmit: (file: File) => void | Promise<void>;
  showSnack: (message: string, type?: SnackbarType) => void;
  pastedUrl: string;
  onPastedUrlConsumed: () => void;
}

export default function UploadZone({
  hasImages,
  onFilesSelected,
  onUrlSubmit,
  showSnack,
  pastedUrl,
  onPastedUrlConsumed,
}: UploadZoneProps) {
  const { t } = useTranslation();
  const [isDragging, setIsDragging] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [imageUrl, setImageUrl] = useState('');
  const dropZoneRef = useRef<HTMLDivElement | null>(null);
  const isDraggingGlobalRef = useRef(false);

  useEffect(() => {
    if (pastedUrl) {
      setImageUrl(pastedUrl);
      setShowUrlInput(true);
      onPastedUrlConsumed();
    }
  }, [pastedUrl, onPastedUrlConsumed]);

  useEffect(() => {
    const handleGlobalDragEnter = (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (!isDraggingGlobalRef.current) {
        isDraggingGlobalRef.current = true;
        setIsDragging(true);
      }
    };

    const handleGlobalDragLeave = (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const rect = document.body.getBoundingClientRect();
      if ((event.clientX ?? 0) <= rect.left || (event.clientX ?? 0) >= rect.right || (event.clientY ?? 0) <= rect.top || (event.clientY ?? 0) >= rect.bottom) {
        isDraggingGlobalRef.current = false;
        setIsDragging(false);
      }
    };

    const handleGlobalDrop = (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      isDraggingGlobalRef.current = false;
      setIsDragging(false);
    };

    const preventDragDefault = (event: DragEvent) => event.preventDefault();

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
  }, []);

  const handleDragEnter = useCallback((event: ReactDragEvent<HTMLDivElement>) => { event.preventDefault(); event.stopPropagation(); }, []);
  const handleDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>) => { event.preventDefault(); event.stopPropagation(); }, []);

  const handleDragLeave = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!dropZoneRef.current) return;
    const rect = dropZoneRef.current.getBoundingClientRect();
    if (event.clientX <= rect.left || event.clientX >= rect.right || event.clientY <= rect.top || event.clientY >= rect.bottom) {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback(async (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    isDraggingGlobalRef.current = false;

    const items = Array.from(event.dataTransfer.items);
    const filePromises = items.map(async (item) => {
      if (item.kind === 'string') {
        const url = await new Promise<string>((resolve) => item.getAsString(resolve));
        if (url.match(/\.(jpg|jpeg|png|gif|webp)$/i) || url.startsWith('data:image/')) {
          try {
            return await fetchImageFromUrl(url);
          } catch {
            return null;
          }
        }
      } else if (item.kind === 'file') {
        return item.getAsFile();
      }
      return null;
    });

    const files = (await Promise.all(filePromises)).filter((file): file is File => file instanceof File);
    if (files.length > 0) onFilesSelected(files);
  }, [onFilesSelected]);

  const handleFileInput = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length > 0) onFilesSelected(files);
    event.target.value = '';
  }, [onFilesSelected]);

  const handleUrlSubmit = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!imageUrl) return;

    try {
      const file = await fetchImageFromUrl(imageUrl);
      await onUrlSubmit(file);
      setShowUrlInput(false);
      setImageUrl('');
    } catch (error: unknown) {
      uiLogger.error('Error loading image:', error);
      let message = t('error.loadImageFailed') + '，';
      if (error instanceof DOMException && error.name === 'AbortError') message += t('error.timeout');
      else if (error instanceof Error && error.message.includes('CORS')) message += t('error.cors');
      else if (error instanceof Error && error.message.includes('network')) message += t('error.network');
      else message += t('error.generic');
      message += ' ' + t('error.saveAsHint');
      showSnack(message, 'error');
    }
  }, [imageUrl, onUrlSubmit, showSnack, t]);

  return (
    <div
      ref={dropZoneRef}
      className={`upload-zone ${isDragging ? 'dragging' : ''}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      aria-label={t('upload.dropTitle')}
      role="region"
    >
      {isDragging && (
        <div className="upload-zone__drag-hint" aria-live="assertive" aria-atomic="true">
          {t('upload.dragHint')}
        </div>
      )}
      {!hasImages && !showUrlInput && (
        <div className="upload-zone__empty">
          <div className="upload-zone__icon-wrapper">
            <span className="material-icons-round">cloud_upload</span>
          </div>
          <p className="upload-zone__title">{t('upload.dropTitle')}</p>
          <p className="upload-zone__subtitle">{t('upload.dropSubtitle')}</p>
        </div>
      )}

      <div className="upload-actions">
        <label className="md-button md-button--filled" htmlFor="file-input">
          <span className="material-icons-round">upload_file</span>
          <span>{hasImages ? t('upload.reuploadButton') : t('upload.uploadButton')}</span>
        </label>
        <input id="file-input" type="file" accept="image/*,.pdf,application/pdf" onChange={handleFileInput} multiple className="sr-only" />
        <button className="md-button md-button--outlined" onClick={() => setShowUrlInput((visible) => !visible)}>
          <span className="material-icons-round">link</span>
          <span>{showUrlInput ? t('upload.cancel') : t('upload.useLink')}</span>
        </button>
      </div>

      {showUrlInput && (
        <form onSubmit={handleUrlSubmit} className="url-form">
          <div className="md-text-field">
            <input
              type="url"
              value={imageUrl}
              onChange={(event) => setImageUrl(event.target.value)}
              placeholder=" "
              className="md-text-field__input"
              id="url-input"
            />
            <label htmlFor="url-input" className="md-text-field__label">{t('upload.urlPlaceholder')}</label>
          </div>
          <button type="submit" className="md-button md-button--filled">
            <span className="material-icons-round">send</span>
            <span>{t('upload.confirm')}</span>
          </button>
        </form>
      )}
    </div>
  );
}
