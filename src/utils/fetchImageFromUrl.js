const ALLOWED_PROTOCOLS = new Set(['https:', 'http:', 'data:']);

export default async function fetchImageFromUrl(url) {
  let parsedProtocol;
  if (url.startsWith('data:')) {
    parsedProtocol = 'data:';
  } else {
    try {
      parsedProtocol = new URL(url).protocol;
    } catch {
      throw new Error('无效的图片链接，请检查 URL 格式。');
    }
  }
  if (!ALLOWED_PROTOCOLS.has(parsedProtocol)) {
    throw new Error(`不支持的协议 "${parsedProtocol}"，仅允许 https / http 链接。`);
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
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        throw new Error('请求超时，请检查网络连接。可尝试右键另存为后上传。');
      }
      if (err instanceof TypeError) {
        throw Object.assign(
          new Error('CORS 或网络错误，该图片可能有访问限制。请右键另存为后上传。'),
          { name: 'NetworkError' },
        );
      }
      throw new Error('无法加载图片，请检查链接是否正确。可尝试右键另存为后上传。');
    } finally {
      clearTimeout(timeoutId);
    }

    // --- 如需启用第三方 CORS 代理回退，取消以下注释 ---
    // 警告：用户的图片 URL 及内容将经过 corsproxy.io 传输
    // const proxyServices = [
    //   null,
    //   (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    // ];
    // let lastError;
    // for (const getProxyUrl of proxyServices) { ... }
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
