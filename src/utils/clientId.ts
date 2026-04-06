const STORAGE_KEY = 'ocr-client-id';

function generateClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    arr[6] = (arr[6] & 0x0f) | 0x40;
    arr[8] = (arr[8] & 0x3f) | 0x80;
    const hex = Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

let clientId: string | null = null;

export function getClientId(): string {
  if (clientId) return clientId;
  try {
    clientId = localStorage.getItem(STORAGE_KEY);
    if (!clientId) {
      clientId = generateClientId();
      localStorage.setItem(STORAGE_KEY, clientId);
    }
  } catch {
    clientId = generateClientId();
  }
  return clientId;
}
