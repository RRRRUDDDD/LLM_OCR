/export function isWebkit() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /WebKit/i.test(ua) && !/Chrome/i.test(ua);
}

export function supportsOffscreenCanvas() {
  return typeof OffscreenCanvas !== 'undefined';
}
