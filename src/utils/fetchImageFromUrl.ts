const ALLOWED_PROTOCOLS = new Set(['https:', 'http:', 'data:']);

// Error names consumers can branch on (instead of fragile message matching).
function namedError(name: 'TimeoutError' | 'NetworkError' | 'InvalidUrlError', message: string): Error {
  return Object.assign(new Error(message), { name });
}

export default async function fetchImageFromUrl(url: string): Promise<File> {
  let parsedProtocol;
  if (url.startsWith('data:')) {
    parsedProtocol = 'data:';
  } else {
    try {
      parsedProtocol = new URL(url).protocol;
    } catch {
      throw namedError('InvalidUrlError', '无效的图片链接，请检查 URL 格式。');
    }
  }
  if (!ALLOWED_PROTOCOLS.has(parsedProtocol)) {
    throw namedError('InvalidUrlError', `不支持的协议 "${parsedProtocol}"，仅允许 https / http 链接。`);
  }

  let imageBlob;

  if (parsedProtocol === 'data:') {
    const resp = await fetch(url);
    imageBlob = await resp.blob();
  } else {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error('Fetch failed');
      imageBlob = await response.blob();
      if (!imageBlob || imageBlob.size === 0) {
        throw new Error('Empty response');
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw namedError('TimeoutError', '请求超时，请检查网络连接。可尝试右键另存为后上传。');
      }
      if (err instanceof TypeError) {
        throw namedError('NetworkError', 'CORS 或网络错误，该图片可能有访问限制。请右键另存为后上传。');
      }
      throw new Error('无法加载图片，请检查链接是否正确。可尝试右键另存为后上传。');
    } finally {
      clearTimeout(timeoutId);
    }
  }

  if (!imageBlob.type.startsWith('image/')) {
    imageBlob = new Blob([imageBlob], { type: 'image/jpeg' });
  }

  const file = new File([imageBlob], 'image.jpg', { type: imageBlob.type });

  // 验证 blob 是否为可解码的图片
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
