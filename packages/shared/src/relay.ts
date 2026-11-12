/** Official base URLs the server-side relay may forward to. */
export const OFFICIAL_BASE_URLS = {
  openai: 'https://api.openai.com/v1',
  ark: 'https://ark.cn-beijing.volces.com/api/v3',
} as const;

export type RelayProvider = keyof typeof OFFICIAL_BASE_URLS;

/** Request body of `POST /api/ai`. */
export interface RelayEnvelope {
  provider: string;
  baseUrl: string;
  apiKey: string;
  path: string;
  method: 'GET' | 'POST';
  body?: unknown;
}

/** Error body every non-2xx `/api` response uses. */
export interface ApiErrorBody {
  error: { code: string; message: string };
}

export const RELAY_PATH = '/api/ai';
