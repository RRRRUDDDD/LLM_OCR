import { useState, useRef, useCallback, useEffect } from 'react';
import compressImage from '../utils/compressImage';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

function isGeminiNative(baseUrl) {
  return baseUrl.includes('googleapis.com') && !baseUrl.includes('/openai');
}

function buildRequest(apiConfig, base64, mimeType) {
  const { baseUrl, apiKey, model, prompt } = apiConfig;

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
        contents: [
          {
            role: 'user',
            parts: [
              { inline_data: { mime_type: mimeType, data: base64 } },
              { text: '请按照系统指令严格转录上图中的全部文字，直接输出结果，不要任何前言或解释。' },
            ],
          },
        ],
        generationConfig: { temperature: 0, maxOutputTokens: 8192 },
      }),
    };
  }

  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  return {
    url,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      stream: true,
      messages: [
        { role: 'system', content: prompt },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:${mimeType};base64,${base64}` },
            },
            {
              type: 'text',
              text: '请按照系统指令严格转录上图中的全部文字，直接输出结果，不要任何前言或解释。',
            },
          ],
        },
      ],
      temperature: 0,
      max_tokens: 8192,
    }),
  };
}

function parseSSEChunk(chunk, geminiNative) {
  // SSE 事件块以空行分隔，每个块可含多行 data:
  let result = '';
  const events = chunk.split(/\n\n+/);
  for (const event of events) {
    const dataLines = event.split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(l.indexOf(':') + 1).trim());
    const payload = dataLines.join('');
    if (!payload || payload === '[DONE]') continue;
    try {
      const data = JSON.parse(payload);
      if (geminiNative) {
        result += data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      } else {
        result += data.choices?.[0]?.delta?.content || '';
      }
    } catch {
      // 忽略不完整的 JSON 块（流式传输中的正常情况）
    }
  }
  return result;
}

function abortableDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function fetchWithRetry(url, options, retries = MAX_RETRIES) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, options);

      if (response.ok) return response;

      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === retries) {
        const errText = await response.text();
        const err = new Error(`API error: ${response.status} ${errText}`);
        if (response.status === 429) err.isRateLimit = true;
        throw err;
      }

      let delay;
      const retryAfter = response.headers.get('Retry-After');
      if (retryAfter && response.status === 429) {
        delay = (parseInt(retryAfter, 10) || 1) * 1000;
      } else {
        const base = BASE_DELAY_MS * Math.pow(2, attempt); // 1s, 2s, 4s
        delay = Math.random() * base;
      }

      await abortableDelay(delay, options.signal);
    } catch (error) {
      if (error.name === 'AbortError') throw error;

      if (error instanceof TypeError && attempt < retries) {
        const base = BASE_DELAY_MS * Math.pow(2, attempt);
        await abortableDelay(Math.random() * base, options.signal);
        continue;
      }

      throw error;
    }
  }
}

const STATUS_IDLE = 'idle';
const STATUS_PROCESSING = 'processing';
const STATUS_DONE = 'done';
const STATUS_ERROR = 'error';

export { STATUS_IDLE, STATUS_PROCESSING, STATUS_DONE, STATUS_ERROR };

export default function useOcrApi(apiConfig) {
  const [results, setResults] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const abortControllersRef = useRef(new Map());
  const rafIdsRef = useRef(new Map());
  const activeCountRef = useRef(0);

  useEffect(() => {
    const controllers = abortControllersRef.current;
    const rafIds = rafIdsRef.current;
    return () => {
      controllers.forEach((c) => c.abort());
      rafIds.forEach((id) => cancelAnimationFrame(id));
      controllers.clear();
      rafIds.clear();
    };
  }, []);

  const cancelAll = useCallback(() => {
    abortControllersRef.current.forEach((c) => c.abort());
    abortControllersRef.current.clear();
    rafIdsRef.current.forEach((id) => cancelAnimationFrame(id));
    rafIdsRef.current.clear();
    activeCountRef.current = 0;
    setIsLoading(false);
  }, []);

  const ensureResultSlots = useCallback((count) => {
    setResults((prev) => {
      if (prev.length >= count) return prev;
      return [...prev, ...new Array(count - prev.length).fill('')];
    });
    setStatuses((prev) => {
      if (prev.length >= count) return prev;
      return [...prev, ...new Array(count - prev.length).fill(STATUS_IDLE)];
    });
  }, []);

  const processFile = useCallback(async (file, index) => {
    if (!file || !file.type.startsWith('image/')) return;
    if (!apiConfig.apiKey) return;

    const existing = abortControllersRef.current.get(index);
    if (existing) existing.abort();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90_000);
    abortControllersRef.current.set(index, controller);

    activeCountRef.current++;
    setIsLoading(true);

    const geminiNative = isGeminiNative(apiConfig.baseUrl);

    try {
      setResults((prev) => {
        const r = [...prev];
        r[index] = '';
        return r;
      });
      setStatuses((prev) => {
        const s = [...prev];
        s[index] = STATUS_PROCESSING;
        return s;
      });

      const { base64, mimeType } = await compressImage(file);

      const { url, headers, body } = buildRequest(apiConfig, base64, mimeType);

      const response = await fetchWithRetry(
        url,
        {
          method: 'POST',
          headers,
          body,
          signal: controller.signal,
        },
      );

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let chunkBuffer = '';

      let pendingUpdate = false;
      const scheduleUpdate = () => {
        if (pendingUpdate) return;
        pendingUpdate = true;
        const rafId = requestAnimationFrame(() => {
          pendingUpdate = false;
          rafIdsRef.current.delete(index);
          const text = fullText;
          setResults((prev) => {
            const r = [...prev];
            r[index] = text;
            return r;
          });
        });
        rafIdsRef.current.set(index, rafId);
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const raw = decoder.decode(value, { stream: true });
        chunkBuffer += raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        // 按双换行切分完整事件块，保留最后一个可能不完整的块
        const lastDouble = chunkBuffer.lastIndexOf('\n\n');
        if (lastDouble !== -1) {
          const complete = chunkBuffer.slice(0, lastDouble + 2);
          chunkBuffer = chunkBuffer.slice(lastDouble + 2);
          const content = parseSSEChunk(complete, geminiNative);
          if (content) {
            fullText += content;
            scheduleUpdate();
          }
        }
      }

      // 处理流结束后缓冲区中剩余的内容
      chunkBuffer += decoder.decode();

      if (chunkBuffer.trim()) {
        const content = parseSSEChunk(chunkBuffer, geminiNative);
        if (content) fullText += content;
      }

      const pendingRafId = rafIdsRef.current.get(index);
      if (pendingRafId != null) {
        cancelAnimationFrame(pendingRafId);
        rafIdsRef.current.delete(index);
      }

      // 若 prompt 要求界定符输出，提取标签内容；否则保留原始输出
      const ocrMatch = fullText.match(/<ocr_text>([\s\S]*?)<\/ocr_text>/);
      const finalText = ocrMatch ? ocrMatch[1].trim() : fullText;

      setResults((prev) => {
        const r = [...prev];
        r[index] = finalText;
        return r;
      });
      setStatuses((prev) => {
        const s = [...prev];
        s[index] = STATUS_DONE;
        return s;
      });
    } catch (error) {
      if (error.name === 'AbortError') return;
      console.error('Error details:', error);
      setResults((prev) => {
        const r = [...prev];
        r[index] = `识别出错,请重试 (${error.message})`;
        return r;
      });
      setStatuses((prev) => {
        const s = [...prev];
        s[index] = STATUS_ERROR;
        return s;
      });
    } finally {
      clearTimeout(timeoutId);
      if (abortControllersRef.current.get(index) === controller) {
        abortControllersRef.current.delete(index);
      }
      const leftoverRaf = rafIdsRef.current.get(index);
      if (leftoverRaf != null) {
        cancelAnimationFrame(leftoverRaf);
        rafIdsRef.current.delete(index);
      }
      activeCountRef.current = Math.max(0, activeCountRef.current - 1);
      if (activeCountRef.current === 0) setIsLoading(false);
    }
  }, [apiConfig]);

  const processFiles = useCallback(async (files, startIndex, maxConcurrent = 5) => {
    if (files.length === 0) return;

    let concurrency = Math.max(1, Math.min(maxConcurrent, files.length));
    let nextIdx = 0;
    const total = files.length;

    await new Promise((resolveAll) => {
      let completed = 0;

      const startNext = () => {
        while (nextIdx < total && (nextIdx - completed) < concurrency) {
          const i = nextIdx++;
          processFile(files[i], startIndex + i).then(
            () => {
              completed++;
              if (concurrency < maxConcurrent) concurrency = Math.min(maxConcurrent, concurrency + 1);
              if (completed === total) resolveAll();
              else startNext();
            },
            (err) => {
              if (err?.isRateLimit) {
                concurrency = Math.max(1, Math.floor(concurrency / 2));
              }
              completed++;
              if (completed === total) resolveAll();
              else startNext();
            },
          );
        }
      };

      startNext();
    });
  }, [processFile]);

  const clearResults = useCallback(() => {
    setResults([]);
    setStatuses([]);
  }, []);

  return {
    results,
    statuses,
    isLoading,
    ensureResultSlots,
    processFile,
    processFiles,
    clearResults,
    cancelAll,
  };
}
