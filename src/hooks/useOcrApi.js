import { useState, useRef, useCallback } from 'react';
import compressImage from '../utils/compressImage';

/**
 * Handles OCR API calls with streaming SSE.
 *
 * Optimizations:
 * - Client-side image compression via Canvas (compressImage)
 * - Per-index rAF IDs to avoid cross-cancellation in batch mode
 * - Sliding-window concurrency (Semaphore) instead of fixed batches
 * - Exponential backoff retry for 429 / 5xx / network errors
 */

/** Max retry attempts for transient errors */
const MAX_RETRIES = 3;
/** Base delay in ms for exponential backoff */
const BASE_DELAY_MS = 1000;

/**
 * Abort-aware delay — resolves after `ms` or rejects immediately on abort signal.
 */
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

/**
 * Fetch with exponential backoff retry.
 * Retries on: 429 (rate limit), 5xx (server error), network TypeError.
 * Respects Retry-After header when present.
 * Retry delays are abort-aware — user can cancel immediately during backoff.
 */
async function fetchWithRetry(url, options, retries = MAX_RETRIES) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, options);

      if (response.ok) return response;

      // Determine if this error is retryable
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === retries) {
        const errText = await response.text();
        throw new Error(`API error: ${response.status} ${errText}`);
      }

      // Calculate delay — respect Retry-After header for 429
      let delay;
      const retryAfter = response.headers.get('Retry-After');
      if (retryAfter && response.status === 429) {
        delay = (parseInt(retryAfter, 10) || 1) * 1000;
      } else {
        delay = BASE_DELAY_MS * Math.pow(2, attempt); // 1s, 2s, 4s
      }

      await abortableDelay(delay, options.signal);
    } catch (error) {
      // AbortError — never retry
      if (error.name === 'AbortError') throw error;

      // Network errors (TypeError from fetch) — retry
      if (error instanceof TypeError && attempt < retries) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        await abortableDelay(delay, options.signal);
        continue;
      }

      throw error;
    }
  }
}

export default function useOcrApi(apiConfig) {
  const [results, setResults] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const abortControllersRef = useRef(new Map());
  // Per-index rAF IDs — avoids cross-cancellation when multiple images process in parallel
  const rafIdsRef = useRef(new Map());
  const activeCountRef = useRef(0);

  const ensureResultSlots = useCallback((count) => {
    setResults((prev) => {
      if (prev.length >= count) return prev;
      return [...prev, ...new Array(count - prev.length).fill('')];
    });
  }, []);

  const processFile = useCallback(async (file, index) => {
    if (!file || !file.type.startsWith('image/')) return;
    if (!apiConfig.apiKey) return;

    // Abort previous request for this index
    const existing = abortControllersRef.current.get(index);
    if (existing) existing.abort();

    const controller = new AbortController();
    abortControllersRef.current.set(index, controller);

    // Track active count for loading state
    activeCountRef.current++;
    setIsLoading(true);

    try {
      // Clear previous result for this index
      setResults((prev) => {
        const r = [...prev];
        r[index] = '';
        return r;
      });

      // Compress image before base64 encoding (skips small files automatically)
      const { base64, mimeType } = await compressImage(file);

      const response = await fetchWithRetry(
        `${apiConfig.baseUrl}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiConfig.apiKey}`,
          },
          body: JSON.stringify({
            model: apiConfig.model,
            stream: true,
            messages: [
              { role: 'system', content: apiConfig.prompt },
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
          signal: controller.signal,
        },
      );

      // Stream-aware TextDecoder + line buffer
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let lineBuffer = '';

      // Per-index rAF-throttled state update
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

        // stream: true prevents truncating multi-byte chars at chunk boundaries
        const chunk = decoder.decode(value, { stream: true });
        lineBuffer += chunk;

        // Process complete lines only; keep incomplete last line in buffer
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            try {
              const data = JSON.parse(line.slice(6));
              const content = data.choices?.[0]?.delta?.content || '';
              if (content) {
                fullText += content;
                scheduleUpdate();
              }
            } catch {
              // skip invalid JSON lines
            }
          }
        }
      }

      // Process any remaining data in buffer
      if (lineBuffer.startsWith('data: ') && lineBuffer !== 'data: [DONE]') {
        try {
          const data = JSON.parse(lineBuffer.slice(6));
          const content = data.choices?.[0]?.delta?.content || '';
          if (content) fullText += content;
        } catch { /* skip */ }
      }

      // Final flush — cancel pending rAF for this index, commit last text
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
    } catch (error) {
      if (error.name === 'AbortError') return;
      console.error('Error details:', error);
      setResults((prev) => {
        const r = [...prev];
        r[index] = `识别出错,请重试 (${error.message})`;
        return r;
      });
    } finally {
      abortControllersRef.current.delete(index);
      rafIdsRef.current.delete(index);
      activeCountRef.current--;
      if (activeCountRef.current === 0) setIsLoading(false);
    }
  }, [apiConfig]);

  // Sliding-window concurrency (Semaphore pattern)
  // Starts next task as soon as one finishes — no blocking on slowest in batch
  const processFiles = useCallback(async (files, startIndex, maxConcurrent = 5) => {
    if (files.length === 0) return;

    let nextIdx = 0;
    const total = files.length;

    await new Promise((resolveAll) => {
      let completed = 0;

      const startNext = () => {
        while (nextIdx < total && (nextIdx - completed) < maxConcurrent) {
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
  }, []);

  return {
    results,
    isLoading,
    ensureResultSlots,
    processFile,
    processFiles,
    clearResults,
  };
}
