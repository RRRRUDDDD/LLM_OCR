export interface ApiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
}

export interface OcrRequestPayload {
  url: string;
  headers: Record<string, string>;
  body: string;
}
