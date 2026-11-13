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
  /** upstreamCode: the provider's own error code, passed through by the relay when it has one. */
  error: { code: string; message: string; upstreamCode?: string };
}

export const RELAY_PATH = '/api/ai';
