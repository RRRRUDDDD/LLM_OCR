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
          ],
        },
      ],
      temperature: 0,
      max_tokens: 8192,
    }),
  };
}

function parseSSELine(line, geminiNative) {
  if (!line.startsWith('data:')) return '';

  const payload = line.slice(line.indexOf(':') + 1).trim();
  if (!payload || payload === '[DONE]') return '';

  try {
    const data = JSON.parse(payload);
    if (geminiNative) {
      return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }
    return data.choices?.[0]?.delta?.content || '';
  } catch {
    return '';
  }
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
        throw new Error(`API error: ${response.status} ${errText}`);
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
      let lineBuffer = '';

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

        const chunk = decoder.decode(value, { stream: true });
        lineBuffer += chunk;

        lineBuffer = lineBuffer.replace(/\r/g, '');

        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() || '';

        for (const line of lines) {
          const content = parseSSELine(line, geminiNative);
          if (content) {
            fullText += content;
            scheduleUpdate();
          }
        }
      }

      lineBuffer += decoder.decode();

      if (lineBuffer) {
        const content = parseSSELine(lineBuffer, geminiNative);
        if (content) fullText += content;
      }

      const pendingRafId = rafIdsRef.current.get(index);
      if (pendingRafId != null) {
        cancelAnimationFrame(pendingRafId);
        rafIdsRef.current.delete(index);
      }
      setResults((prev) => {
        const r = [...prev];
        r[index] = fullText;
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

    const concurrency = Math.max(1, maxConcurrent);
    let nextIdx = 0;
    const total = files.length;

    await new Promise((resolveAll) => {
      let completed = 0;

      const startNext = () => {
        while (nextIdx < total && (nextIdx - completed) < concurrency) {
          const i = nextIdx++;
          processFile(files[i], startIndex + i).catch(() => {}).then(() => {
            completed++;
            if (completed === total) {
              resolveAll();
            } else {
              startNext();
            }
          });
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
