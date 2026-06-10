export type OcrProvider = 'openai_compatible' | 'gemini_native' | 'deepseek_ocr_api';

export type PromptPreset = 'transcribe' | 'book';

export interface ApiConfig {
  provider: OcrProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  promptPreset?: PromptPreset;
  ocrLanguage?: string;
  maxOutputTokens?: number;
  /** Max OCR tasks in flight at once. */
  concurrency?: number;
  /** Max OCR task starts per minute; 0 = unlimited. */
  requestsPerMinute?: number;
}

export interface OcrRequestPayload {
  url: string;
  headers: Record<string, string>;
  body: BodyInit;
}

export function inferProviderFromConfig(config: Partial<ApiConfig>): OcrProvider {
  if (config.provider) return config.provider;
  if ((config.baseUrl || '').includes('googleapis.com') && !(config.baseUrl || '').includes('/openai')) {
    return 'gemini_native';
  }
  return 'openai_compatible';
}
