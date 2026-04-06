import { useState, useRef, useEffect, useCallback, type FormEvent, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import useFocusTrap from '../hooks/useFocusTrap';
import type { ApiConfig } from '../types/api';

const DEFAULT_PROMPT =
  '你是一个精确的 OCR 转录引擎。你的唯一任务是将图片中的文字原样转录。\n\n' +
  '## 绝对规则\n' +
  '1. **零添加**：不要输出图片中不存在的任何文字——不写标题、不加开场白、不做总结、不附解释。\n' +
  '2. **零删减**：图片中出现的每一个字、每一个符号都必须出现在输出中，不得省略、合并或改写。\n' +
  '3. **原样排版**：严格保留原文的换行、空行、缩进、段落间距、编号层级和标点符号。\n' +
  '4. **逐字忠实**：不纠正错别字、不润色措辞、不调整语序。原文写错了也照抄。\n' +
  '5. **无法识别**：遇到污损、模糊、遮挡导致完全无法辨认的字词，用 [?] 占位，不要猜测。\n\n' +
  '## 表格规则\n' +
  '6. **表格识别**：如果图片中包含表格，必须使用 Markdown 表格语法输出（`| 列1 | 列2 |` 格式），保留所有行列结构。\n' +
  '7. **表头分隔**：表格第一行后必须有 `|---|---|` 分隔行。\n' +
  '8. **合并单元格**：如遇合并单元格，在对应位置重复填入相同内容。\n' +
  '9. **嵌套表格**：如有多个表格，各表格之间用空行分隔。\n\n' +
  '## 数学公式规则\n' +
  '10. **公式识别**：数学公式使用 LaTeX 语法，行内公式用 `$...$`，独立公式用 `$$...$$`。\n\n' +
  '## 输出格式\n' +
  '11. 将转录结果完整放置在 <ocr_text> 与 </ocr_text> 标签之间，标签外不输出任何内容。\n' +
  '现在请转录图片中的全部文字。';

export const DEFAULT_API_CONFIG: ApiConfig = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o',
  prompt: DEFAULT_PROMPT,
};

type UrlErrorKey = 'settings.urlHttpsRequired' | 'settings.urlInvalid';

interface SettingsDialogProps {
  isOpen: boolean;
  apiConfig: ApiConfig;
  onSave: (config: ApiConfig) => void;
  onClose: () => void;
}

function validateBaseUrl(url: string): UrlErrorKey | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (!isLocalhost && parsed.protocol !== 'https:') return 'settings.urlHttpsRequired';
  } catch {
    return 'settings.urlInvalid';
  }
  return null;
}

export default function SettingsDialog({ isOpen, apiConfig, onSave, onClose }: SettingsDialogProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<ApiConfig>(apiConfig);
  const [showApiKey, setShowApiKey] = useState(false);
  const [urlError, setUrlError] = useState<UrlErrorKey | null>(null);

  const keyRef = useRef<HTMLInputElement | null>(null);
  const trapRef = useFocusTrap<HTMLFormElement>(isOpen);

  useEffect(() => {
    if (isOpen) {
      setForm(apiConfig);
      setShowApiKey(false);
      setUrlError(null);
      requestAnimationFrame(() => keyRef.current?.focus());
    }
  }, [isOpen, apiConfig]);

  const handleSubmit = useCallback((event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const trimmed: ApiConfig = {
      baseUrl: form.baseUrl.trim() || DEFAULT_API_CONFIG.baseUrl,
      apiKey: form.apiKey.trim(),
      model: form.model.trim() || DEFAULT_API_CONFIG.model,
      prompt: form.prompt.trimEnd() || DEFAULT_API_CONFIG.prompt,
    };

    const validationError = validateBaseUrl(trimmed.baseUrl);
    if (validationError) {
      setUrlError(validationError);
      return;
    }
    if (!trimmed.apiKey) {
      keyRef.current?.focus();
      return;
    }
    onSave(trimmed);
  }, [form, onSave]);

  const handleReset = useCallback(() => {
    setForm(DEFAULT_API_CONFIG);
    setUrlError(null);
  }, []);

  const updateField = useCallback((field: keyof ApiConfig) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const nextValue = event.target.value;
    setForm((prev) => ({ ...prev, [field]: nextValue }));
    if (field === 'baseUrl') setUrlError(null);
  }, []);

  if (!isOpen) return null;

  return (
    <div className="md-scrim settings-overlay" onClick={onClose} role="presentation">
      <form
        ref={trapRef}
        className="settings-dialog md-elevation-5"
        onClick={(event) => event.stopPropagation()}
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <h2 className="settings-dialog__title" id="settings-title">{t('settings.title')}</h2>
        <p className="settings-dialog__desc">{t('settings.storedLocally', 'Settings are stored in your browser and persist across refreshes')}</p>

        <div className="settings-dialog__form">
          <div className="md-text-field">
            <input
              type="text"
              value={form.baseUrl}
              onChange={updateField('baseUrl')}
              placeholder=" "
              className={`md-text-field__input ${urlError ? 'md-text-field__input--error' : ''}`}
              id="settings-base-url"
              aria-describedby={urlError ? 'settings-base-url-error' : undefined}
              aria-invalid={Boolean(urlError)}
            />
            <label htmlFor="settings-base-url" className="md-text-field__label">{t('settings.baseUrl')}</label>
          </div>
          {urlError && (
            <p id="settings-base-url-error" className="settings-dialog__helper settings-dialog__helper--error" role="alert">
              {t(urlError)}
            </p>
          )}

          <div className="md-text-field md-text-field--with-trailing">
            <input
              ref={keyRef}
              type={showApiKey ? 'text' : 'password'}
              value={form.apiKey}
              onChange={updateField('apiKey')}
              placeholder=" "
              className={`md-text-field__input ${!form.apiKey.trim() ? 'md-text-field__input--error' : ''}`}
              id="settings-api-key"
            />
            <label htmlFor="settings-api-key" className="md-text-field__label">{t('settings.apiKey')} *</label>
            <button
              type="button"
              className="md-text-field__trailing md-icon-button"
              onClick={() => setShowApiKey((visible) => !visible)}
              aria-label={showApiKey ? t('settings.hideKey', 'Hide key') : t('settings.showKey', 'Show key')}
              aria-pressed={showApiKey}
            >
              <span className="material-icons-round">{showApiKey ? 'visibility_off' : 'visibility'}</span>
            </button>
          </div>
          {!form.apiKey.trim() && (
            <p id="settings-api-key-error" className="settings-dialog__helper settings-dialog__helper--error" role="alert">
              {t('settings.apiKeyRequired')}
            </p>
          )}

          <div className="md-text-field">
            <input
              type="text"
              value={form.model}
              onChange={updateField('model')}
              placeholder=" "
              className="md-text-field__input"
              id="settings-model"
            />
            <label htmlFor="settings-model" className="md-text-field__label">{t('settings.model')}</label>
          </div>

          <div className="md-text-field md-text-field--textarea">
            <textarea
              value={form.prompt}
              onChange={updateField('prompt')}
              placeholder=" "
              className="md-text-field__input md-text-field__textarea"
              id="settings-prompt"
              rows={4}
            />
            <label htmlFor="settings-prompt" className="md-text-field__label">{t('settings.prompt')}</label>
          </div>
        </div>

        <div className="settings-dialog__actions">
          <button type="button" className="md-button md-button--text" onClick={handleReset}>
            {t('settings.reset', 'Reset')}
          </button>
          <div style={{ flex: 1 }} />
          <button type="button" className="md-button md-button--text" onClick={onClose}>
            {t('settings.cancel', 'Cancel')}
          </button>
          <button type="submit" className="md-button md-button--filled" disabled={!form.apiKey.trim()}>
            {t('settings.save')}
          </button>
        </div>
      </form>
    </div>
  );
}
