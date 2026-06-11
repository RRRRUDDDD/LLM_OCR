import { ocrEvents } from '../events/ocrEvents';
import { queueManager } from './queueManager';
import { healthChecker } from './healthCheck';
import { processFigureMarkers } from './figureExtraction';
import { ocrLogger } from '../utils/logger';
import { getClientId } from '../utils/clientId';
import { delayWithSignal } from '../utils/abort';
import compressImage from '../utils/compressImage';
import type { ApiConfig, OcrRequestPayload } from '../types/api';

type RateLimitType = 'queue_full' | 'client_limit' | 'ip_limit' | 'rate_limit';

const MAX_RETRIES = 3;
const MAX_QUEUE_FULL_RETRIES = 10;
const BASE_DELAY_MS = 1000;
const QUEUE_FULL_RETRY_INTERVAL = 5000;
const REQUEST_TIMEOUT_MS = 90_000;
export const PROGRESS_EMIT_INTERVAL_MS = 50;

interface OcrProgressEmitter {
  push: (text: string) => void;
  flush: () => void;
  cancel: () => void;
}

interface TimeoutSignalHandle {
  signal: AbortSignal;
  /** Restart the idle countdown — call whenever the request shows signs of life. */
  reset: () => void;
  /** True when the abort came from the timeout (not from user cancellation). */
  timedOut: () => boolean;
  cleanup: () => void;
}

function createTimeoutSignal(parentSignal: AbortSignal, timeoutMs: number): TimeoutSignalHandle {
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const onTimeout = () => {
    timer = null;
    timedOut = true;
    controller.abort();
  };

  if (parentSignal.aborted) {
    controller.abort();
  } else {
    timer = setTimeout(onTimeout, timeoutMs);
    parentSignal.addEventListener('abort', () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      controller.abort();
    }, { once: true });
  }

  return {
    signal: controller.signal,
    reset: () => {
      if (timer === null || controller.signal.aborted) return;
      clearTimeout(timer);
      timer = setTimeout(onTimeout, timeoutMs);
    },
    timedOut: () => timedOut,
    cleanup: () => {
      if (timer !== null) clearTimeout(timer);
    },
  };
}

function isGeminiNative(baseUrl: string): boolean {
  return baseUrl.includes('googleapis.com') && !baseUrl.includes('/openai');
}

function isDeepSeekOcrApi(apiConfig: ApiConfig): boolean {
  return apiConfig.provider === 'deepseek_ocr_api';
}

// ── Request Building ──

export function buildRequest(apiConfig: ApiConfig, options: { file: File } | { base64: string; mimeType: string }): OcrRequestPayload {
  const { baseUrl, apiKey, model, prompt, ocrLanguage, maxOutputTokens = 8192 } = apiConfig;

  if (isDeepSeekOcrApi(apiConfig)) {
    if (!('file' in options)) {
      throw new Error('Original file is required for DeepSeek-OCR provider');
    }
    const formData = new FormData();
    formData.append('file', options.file);
    if (prompt.trim()) formData.append('prompt', prompt);
    if (ocrLanguage?.trim()) formData.append('language', ocrLanguage.trim());
    return {
      url: baseUrl.replace(/\/+$/, ''),
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    };
  }

  if (!('base64' in options)) {
    throw new Error('Image encoding is required for this provider');
  }

  const { base64, mimeType } = options;

  if (isGeminiNative(baseUrl)) {
    const url = `${baseUrl.replace(/\/+$/, '')}/models/${model}:streamGenerateContent?alt=sse`;
    return {
      url,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: prompt }] },
        contents: [{
          role: 'user',
          parts: [
            { inline_data: { mime_type: mimeType, data: base64 } },
            { text: prompt.includes('转录') ? '请按照系统指令严格转录上图中的全部文字，直接输出结果。' : 'Transcribe all text in the image following the system instructions.' },
          ],
        }],
        generationConfig: { temperature: 0, maxOutputTokens },
      }),
    };
  }

  // Default: OpenAI-compatible API (GPT, DeepSeek, Qwen, etc.)
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  return {
    url,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      stream: true,
      messages: [
        { role: 'system', content: prompt },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
            { type: 'text', text: prompt.includes('转录') ? '请按照系统指令严格转录上图中的全部文字，直接输出结果。' : 'Transcribe all text in the image following the system instructions.' },
          ],
        },
      ],
      temperature: 0,
      max_tokens: maxOutputTokens,
    }),
  };
}

// ── SSE Parsing ──

function parseSSEChunk(chunk: string, geminiNative: boolean): string {
  let result = '';
  const events = chunk.split(/\n\n+/);
  for (const event of events) {
    // Check for error events (SSE event: field)
    const lines = event.split('\n');
    const eventType = lines.find((l: string) => l.startsWith('event:'))?.slice(6).trim();
    if (eventType === 'error') {
      const dataLine = lines.find((l: string) => l.startsWith('data:'));
      if (dataLine) ocrLogger.warn('SSE error event:', dataLine.slice(5).trim());
      continue;
    }

    const dataLines = lines
      .filter((l: string) => l.startsWith('data:'))
      .map((l: string) => l.slice(l.indexOf(':') + 1).trim());
    const payload = dataLines.join('');
    if (!payload || payload === '[DONE]') continue;

    try {
      const data: any = JSON.parse(payload);

      // Detect Gemini-style error responses
      if (data.error) {
        ocrLogger.warn('API error in stream:', data.error.message || JSON.stringify(data.error));
        continue;
      }

      if (geminiNative) {
        result += data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      } else {
        result += data.choices?.[0]?.delta?.content || '';
      }
    } catch {
      // Incomplete JSON chunk — normal during streaming
    }
  }
  return result;
}

// ── Rate Limit Classification ──

function classifyRateLimitError(status: number, responseText: string): RateLimitType | null {
  if (status !== 429) return null;
  const lower = (responseText || '').toLowerCase();
  if (lower.includes('queue full') || lower.includes('server is busy')) return 'queue_full';
  if (lower.includes('client') && lower.includes('max')) return 'client_limit';
  if (lower.includes('ip') && lower.includes('max')) return 'ip_limit';
  return 'rate_limit';
}

function parseDeepSeekOcrResponse(responseText: string): string {
  try {
    const payload = JSON.parse(responseText);
    if (typeof payload?.text === 'string' && payload.text.trim()) {
      return payload.text;
    }
    if (typeof payload?.data?.text === 'string' && payload.data.text.trim()) {
      return payload.data.text;
    }
  } catch {
    if (responseText.trim()) {
      return responseText.trim();
    }
  }
  throw new Error('OCR response did not contain text');
}

export function createProgressEmitter(imageId: string): OcrProgressEmitter {
  let latestText = '';
  let hasPendingEmit = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const emitProgress = () => {
    timer = null;
    if (!hasPendingEmit) return;
    hasPendingEmit = false;
    ocrEvents.emit('ocr:progress', { imageId, text: latestText });
  };

  return {
    push(text: string) {
      latestText = text;
      hasPendingEmit = true;
      if (timer !== null) return;
      timer = setTimeout(emitProgress, PROGRESS_EMIT_INTERVAL_MS);
    },
    flush() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      emitProgress();
    },
    cancel() {
      hasPendingEmit = false;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

// ── Fetch with Smart Retry ──

async function fetchWithSmartRetry(url: string, options: RequestInit, signal: AbortSignal, onAttempt?: () => void): Promise<Response> {
  let queueFullRetries = 0;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    onAttempt?.();

    try {
      const response = await fetch(url, { ...options, signal });

      if (response.ok) {
        healthChecker.reportSuccess();
        return response;
      }

      const errorText = await response.text().catch(() => '');
      const rateLimitType = classifyRateLimitError(response.status, errorText);

      if (rateLimitType === 'queue_full') {
        queueFullRetries++;
        if (queueFullRetries > MAX_QUEUE_FULL_RETRIES) {
          throw new Error('Server queue full after max retries');
        }
        healthChecker.reportRateLimit();
        ocrLogger.warn(`Queue full (${queueFullRetries}/${MAX_QUEUE_FULL_RETRIES}), waiting ${QUEUE_FULL_RETRY_INTERVAL}ms...`);
        await delayWithSignal(QUEUE_FULL_RETRY_INTERVAL, signal);
        attempt--; // Don't consume a normal retry for queue_full
        continue;
      }

      if (rateLimitType) {
        healthChecker.reportRateLimit();
        const retryAfter = response.headers.get('Retry-After');
        const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : BASE_DELAY_MS * Math.pow(2, attempt);
        ocrLogger.warn(`Rate limited (${rateLimitType}), retrying in ${delay}ms`);
        await delayWithSignal(delay, signal);
        continue;
      }

      if (response.status >= 500 && attempt < MAX_RETRIES) {
        healthChecker.reportFailure();
        const delay = BASE_DELAY_MS * Math.pow(2, attempt) * (0.5 + Math.random());
        await delayWithSignal(delay, signal);
        continue;
      }

      healthChecker.reportFailure();
      throw new Error(`API error: ${response.status} ${errorText.slice(0, 200)}`);
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;

      if (error instanceof TypeError && attempt < MAX_RETRIES) {
        healthChecker.reportFailure();
        const delay = BASE_DELAY_MS * Math.pow(2, attempt) * (0.5 + Math.random());
        await delayWithSignal(delay, signal);
        continue;
      }

      healthChecker.reportFailure();
      throw error;
    }
  }
  throw new Error('Max retries exceeded');
}

export function queueOcrTask(imageId: string, file: File, apiConfig: ApiConfig): void {
  if (!apiConfig.apiKey) return;

  queueManager.add(imageId, async (signal) => {
    // Idle-timeout protection: abort if nothing happens for REQUEST_TIMEOUT_MS.
    // The countdown restarts on every retry attempt and every streamed chunk,
    // so long-but-alive responses are never killed mid-stream.
    const timeout = createTimeoutSignal(signal, REQUEST_TIMEOUT_MS);
    const progressEmitter = createProgressEmitter(imageId);

    const timeoutError = () =>
      new Error(`Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s without a response`);

    try {
      const deepSeekOcrApi = isDeepSeekOcrApi(apiConfig);
      const geminiNative = isGeminiNative(apiConfig.baseUrl);
      const request = deepSeekOcrApi
        ? buildRequest(apiConfig, { file })
        : (() => {
            const encodedPromise = compressImage(file, {}, timeout.signal);
            return encodedPromise.then(({ base64, mimeType }) => buildRequest(apiConfig, { base64, mimeType }));
          })();

      const { url, headers, body } = await request;

      const response = await fetchWithSmartRetry(url, {
        method: 'POST',
        headers: { ...headers, 'X-Client-ID': getClientId() },
        body,
      }, timeout.signal, timeout.reset);

      if (timeout.signal.aborted) {
        if (timeout.timedOut()) throw timeoutError();
        return; // user cancellation — queueManager already emitted ocr:cancelled
      }

      if (deepSeekOcrApi) {
        const responseText = await response.text();
        const text = parseDeepSeekOcrResponse(responseText);
        ocrEvents.emit('ocr:success', { imageId, text: await processFigureMarkers(imageId, text) });
        return;
      }

      // Stream response
      if (!response.body) {
        throw new Error('Streaming response body is unavailable');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let chunkBuffer = '';

      while (true) {
        if (timeout.signal.aborted) {
          if (timeout.timedOut()) throw timeoutError();
          return;
        }
        const { done, value } = await reader.read();
        if (done) break;
        timeout.reset();

        const raw = decoder.decode(value, { stream: true });
        chunkBuffer += raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        const lastDouble = chunkBuffer.lastIndexOf('\n\n');
        if (lastDouble !== -1) {
          const complete = chunkBuffer.slice(0, lastDouble + 2);
          chunkBuffer = chunkBuffer.slice(lastDouble + 2);
          const content = parseSSEChunk(complete, geminiNative);
          if (content) {
            fullText += content;
            progressEmitter.push(fullText);
          }
        }
      }

      // Flush remaining buffer
      chunkBuffer += decoder.decode();
      if (chunkBuffer.trim()) {
        const content = parseSSEChunk(chunkBuffer, geminiNative);
        if (content) fullText += content;
      }

      progressEmitter.flush();

      // Extract tagged content if present
      const ocrMatch = fullText.match(/<ocr_text>([\s\S]*?)<\/ocr_text>/);
      const finalText = ocrMatch ? ocrMatch[1].trim() : fullText;

      // Book mode: crop figure bboxes out of the page image and rewrite
      // markers to stable figure:// references (no-op without markers).
      const processedText = await processFigureMarkers(imageId, finalText);

      ocrEvents.emit('ocr:success', { imageId, text: processedText });
    } catch (error: unknown) {
      // A timeout abort surfaces as AbortError from fetch/reader — convert it to a
      // regular error so queueManager emits ocr:error instead of swallowing it,
      // which would leave the page stuck in "processing" forever.
      if (error instanceof DOMException && error.name === 'AbortError' && timeout.timedOut() && !signal.aborted) {
        throw timeoutError();
      }
      throw error;
    } finally {
      progressEmitter.cancel();
      timeout.cleanup();
    }
  });
}
