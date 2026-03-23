/**
 * Fetch an image from a URL (direct or data-URL) and return a validated File.
 *
 * P1-2: Third-party CORS proxy (corsproxy.io) is disabled by default for privacy.
 * If direct fetch fails, a user-friendly error is thrown suggesting to download and upload.
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
    // P1-2: Direct fetch only — no third-party proxy by default
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error('Fetch failed');
      imageBlob = await response.blob();
      if (!imageBlob || imageBlob.size === 0) {
        throw new Error('Empty response');
      }
    } catch (err) {
      clearTimeout(timeoutId);
      // Provide actionable error messages
      if (err.name === 'AbortError') {
        throw new Error('请求超时，请检查网络连接。可尝试右键另存为后上传。');
      }
      if (err instanceof TypeError) {
        // TypeError from fetch = likely CORS or network issue
        throw Object.assign(
          new Error('CORS 或网络错误，该图片可能有访问限制。请右键另存为后上传。'),
          { name: 'NetworkError' },
        );
      }
      throw new Error('无法加载图片，请检查链接是否正确。可尝试右键另存为后上传。');
    } finally {
      clearTimeout(timeoutId);
    }

    // --- Uncomment below to enable third-party CORS proxy fallback ---
    // WARNING: User image URLs and content will pass through corsproxy.io
    // const proxyServices = [
    //   null,
    //   (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    // ];
    // let lastError;
    // for (const getProxyUrl of proxyServices) { ... }
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
