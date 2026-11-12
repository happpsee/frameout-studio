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
