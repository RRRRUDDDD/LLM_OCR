/**
 * Fetch an image from a URL (direct or data-URL) and return a validated File.
 * Tries direct fetch first, then falls back to a CORS proxy.
 *
 * @param {string} url - Image URL or data URL
 * @returns {Promise<File>} Validated image File object
 * @throws {Error} With user-friendly message on failure
 */
export default async function fetchImageFromUrl(url) {
  let imageBlob;

  if (url.startsWith('data:image/')) {
    // Browser-native data URL -> blob conversion
    const resp = await fetch(url);
    imageBlob = await resp.blob();
  } else {
    const proxyServices = [
      null,
      (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    ];

    let lastError;
    for (const getProxyUrl of proxyServices) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      try {
        const fetchUrl = getProxyUrl ? getProxyUrl(url) : url;
        const response = await fetch(fetchUrl, {
          ...(getProxyUrl ? {
            headers: { 'x-requested-with': 'XMLHttpRequest', 'origin': window.location.origin },
          } : {}),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Fetch failed');
        imageBlob = await response.blob();
        if (imageBlob.size > 0) { clearTimeout(timeoutId); break; }
      } catch (err) {
        lastError = err;
      } finally {
        clearTimeout(timeoutId);
      }
    }

    if (!imageBlob || imageBlob.size === 0) {
      throw lastError || new Error('Failed to fetch image');
    }
  }

  // Ensure blob has an image MIME type
  if (!imageBlob.type.startsWith('image/')) {
    imageBlob = new Blob([imageBlob], { type: 'image/jpeg' });
  }

  const file = new File([imageBlob], 'image.jpg', { type: imageBlob.type });

  // Validate the blob is a decodable image
  const testUrl = URL.createObjectURL(file);
  try {
    await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = resolve;
      img.onerror = reject;
      img.src = testUrl;
    });
  } finally {
    URL.revokeObjectURL(testUrl);
  }

  return file;
}
