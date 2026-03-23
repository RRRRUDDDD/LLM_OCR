import { useState, useRef, useEffect, useCallback } from 'react';
import useFocusTrap from '../hooks/useFocusTrap';

const DEFAULT_PROMPT =
  '你是一个精确的 OCR 转录引擎。你的唯一任务是将图片中的文字原样转录为纯文本。\n\n' +
  '## 绝对规则\n' +
  '1. **零添加**：不要输出图片中不存在的任何文字——不写标题、不加开场白、不做总结、不附解释、不说"以下是识别结果"之类的话。\n' +
  '2. **零删减**：图片中出现的每一个字、每一个符号都必须出现在输出中，不得省略、合并或改写。\n' +
  '3. **原样排版**：严格保留原文的换行、空行、缩进、段落间距、编号层级和标点符号。输出的视觉结构必须与原图一致。\n' +
  '4. **逐字忠实**：不纠正错别字、不润色措辞、不调整语序。原文写错了也照抄。\n' +
  '5. **无法识别**：遇到污损、模糊、遮挡导致完全无法辨认的字词，用 [?] 占位，不要猜测。\n\n' +
  '现在请转录图片中的全部文字。';

export const DEFAULT_API_CONFIG = {
  // P0-1: Gemini Native API — auto-detected by useOcrApi
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  apiKey: '',
  model: 'gemini-2.5-flash',
  prompt: DEFAULT_PROMPT,
};

/**
 * P1-1: Validate baseUrl — must be HTTPS (except localhost for dev).
 * @returns {string|null} Error message or null if valid
 */
function validateBaseUrl(url) {
  if (!url) return null; // Will fall back to default
  const trimmed = url.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (!isLocalhost && parsed.protocol !== 'https:') {
      return 'API 地址必须使用 HTTPS 协议';
    }
  } catch {
    return 'API 地址格式不正确';
  }
  return null;
}

export default function SettingsDialog({ isOpen, apiConfig, onSave, onClose }) {
  const [form, setForm] = useState(apiConfig);
  const [showApiKey, setShowApiKey] = useState(false);
  const [urlError, setUrlError] = useState(null);
  const keyRef = useRef(null);
  const trapRef = useFocusTrap(isOpen);

  // Sync form when opening + focus key input
  useEffect(() => {
    if (isOpen) {
      setForm(apiConfig);
      setShowApiKey(false);
      setUrlError(null);
      requestAnimationFrame(() => keyRef.current?.focus());
    }
  }, [isOpen, apiConfig]);

  const handleSubmit = useCallback((e) => {
    if (e) e.preventDefault();
    const trimmed = {
      baseUrl: form.baseUrl.trim() || DEFAULT_API_CONFIG.baseUrl,
      apiKey: form.apiKey.trim(),
      model: form.model.trim() || DEFAULT_API_CONFIG.model,
      prompt: form.prompt.trim() || DEFAULT_API_CONFIG.prompt,
    };

    // P1-1: Validate baseUrl before saving
    const urlErr = validateBaseUrl(trimmed.baseUrl);
    if (urlErr) {
      setUrlError(urlErr);
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

  // DRY helper for form field updates
  const updateField = useCallback((field) => (e) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
    // Clear URL error when user edits the URL field
    if (field === 'baseUrl') setUrlError(null);
  }, []);

  if (!isOpen) return null;

  return (
    <div className="md-scrim" onClick={onClose} role="presentation">
      <form
        ref={trapRef}
        className="settings-dialog md-elevation-5"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <h2 className="settings-dialog__title" id="settings-title">API 配置</h2>
        <p className="settings-dialog__desc">配置保存在浏览器本地，刷新页面不会丢失</p>

        <div className="settings-dialog__form">
          <div className="md-text-field">
            <input
              type="text"
              value={form.baseUrl}
              onChange={updateField('baseUrl')}
              placeholder=" "
              className={`md-text-field__input ${urlError ? 'md-text-field__input--error' : ''}`}
              id="settings-base-url"
            />
            <label htmlFor="settings-base-url" className="md-text-field__label">API 地址</label>
          </div>
          {urlError && (
            <p className="settings-dialog__helper settings-dialog__helper--error">{urlError}</p>
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
            <label htmlFor="settings-api-key" className="md-text-field__label">API 密钥 *</label>
            {/* P1-5: Removed tabIndex={-1}, added aria-label */}
            <button
              type="button"
              className="md-text-field__trailing md-icon-button"
              onClick={() => setShowApiKey(!showApiKey)}
              aria-label={showApiKey ? '隐藏密钥' : '显示密钥'}
            >
              <span className="material-icons-round">{showApiKey ? 'visibility_off' : 'visibility'}</span>
            </button>
          </div>
          {!form.apiKey.trim() && (
            <p className="settings-dialog__helper settings-dialog__helper--error">必须填写 API 密钥才能使用 OCR 功能</p>
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
            <label htmlFor="settings-model" className="md-text-field__label">模型名称</label>
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
            <label htmlFor="settings-prompt" className="md-text-field__label">自定义 Prompt</label>
          </div>
        </div>

        <div className="settings-dialog__actions">
          <button type="button" className="md-button md-button--text" onClick={handleReset}>
            恢复默认
          </button>
          <div style={{ flex: 1 }} />
          <button type="button" className="md-button md-button--text" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="md-button md-button--filled" disabled={!form.apiKey.trim()}>
            保存
          </button>
        </div>
      </form>
    </div>
  );
}
