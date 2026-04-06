export interface CompressOptions {
  maxDim?: number;
  quality?: number;
  threshold?: number;
}

export interface CompressResult {
  base64: string;
  mimeType: string;
}

export interface WorkerCompressRequest {
  id: number;
  file: File;
  opts?: CompressOptions;
}

export interface WorkerCompressResponse extends CompressResult {
  id: number;
  error?: string;
}
