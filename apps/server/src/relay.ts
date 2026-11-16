// A request-scoped relay for the two supported official providers.
//
// Do not log envelopes or upstream errors: they may contain the caller's key.
// No redirects, retries, cookies, incoming authorization headers, or response cache.
import type { Response as ExpressResponse } from 'express';
import { OFFICIAL_BASE_URLS, type ApiErrorBody, type OfficialProvider } from '@frameout/shared';
import type { Settings } from './config.ts';

/** Node's fetch reports its own header and body timeouts with these codes. */
const UPSTREAM_TIMEOUT_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);
const TIMEOUT_MESSAGE = '供应商响应超时，未自动重试；已提交的生成请求可能仍在处理中';
const UNAVAILABLE_MESSAGE = '无法连接供应商，请检查接口状态后重试';

/** `body` is JSON text. */
export interface Reply {
  status: number;
  body: string;
}

export interface Target {
  url: string;
  method: 'GET' | 'POST';
  body: Record<string, unknown> | undefined;
  image: boolean;
  /** Non-enumerable, so logging or serializing a target never prints the key. */
  readonly apiKey: string;
}

export type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;

export class RelayError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function failure(
  status: number,
  code: string,
  message: string,
  upstreamCode?: string,
): Reply {
  const body: ApiErrorBody = {
    error: { code, message, ...(upstreamCode ? { upstreamCode } : {}) },
  };
  return { status, body: JSON.stringify(body) };
}

export const send = (res: ExpressResponse, reply: Reply) =>
  res
    .status(reply.status)
    .set({ 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
    .type('json')
    .send(reply.body);

export function redactMessage(value: unknown, apiKey = ''): string {
  let message = typeof value === 'string' ? value : '';
  if (apiKey) {
    // Providers may echo the key URL-encoded, so hide that form too.
    for (const secret of new Set([apiKey, encodeURIComponent(apiKey)]))
      message = message.split(secret).join('[已隐藏]');
  }
  // Count code points, not UTF-16 units, so a cut never splits a character.
  // eslint-disable-next-line no-control-regex -- strips control characters on purpose
  return [...message.replace(/[\x00-\x1f\x7f]/g, ' ').trim()].slice(0, 400).join('');
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isProvider = (value: unknown): value is OfficialProvider =>
  typeof value === 'string' && Object.hasOwn(OFFICIAL_BASE_URLS, value);

/** `provider` and `baseUrl` must name an official provider at its official address. Also used by the task engine. */
export function officialProvider(envelope: Record<string, unknown>): OfficialProvider {
  const { provider } = envelope;
  if (!isProvider(provider))
    throw new RelayError(400, 'UNSUPPORTED_PROVIDER', '此转发仅支持 OpenAI 和火山方舟官方接口');
  const base = OFFICIAL_BASE_URLS[provider];
  if (envelope.baseUrl !== base && envelope.baseUrl !== `${base}/`) {
    throw new RelayError(
      400,
      'INVALID_BASE_URL',
      '转发地址必须是所选供应商的官方 Base URL；自定义接口请使用浏览器直连',
    );
  }
  return provider;
}

export function apiKeyOf(envelope: Record<string, unknown>): string {
  const key = envelope.apiKey;
  if (typeof key !== 'string' || !key)
    throw new RelayError(401, 'MISSING_API_KEY', '请先填写 API Key');
  if (key.length > 4096 || /[^\x21-\x7e]/.test(key))
    throw new RelayError(400, 'INVALID_API_KEY', 'API Key 不能包含空白或控制字符');
  return key;
}

export function validateTarget(envelope: unknown): Target {
  if (!isObject(envelope)) throw new RelayError(400, 'INVALID_REQUEST', '请求格式不正确');
  const provider = officialProvider(envelope);
  const base = OFFICIAL_BASE_URLS[provider];
  const key = apiKeyOf(envelope);
  const { path, method } = envelope;
  if (typeof path !== 'string' || (method !== 'GET' && method !== 'POST')) {
    throw new RelayError(400, 'INVALID_OPERATION', '不支持此接口或请求方式');
  }
  const image = path === '/images/generations' || path === '/images/edits';
  let allowed = method === 'POST' && path === '/images/generations';
  if (provider === 'openai') {
    allowed ||= method === 'GET' && path === '/models';
    // GPT Image models take reference images through the JSON edit endpoint.
    allowed ||= method === 'POST' && path === '/images/edits';
  } else {
    allowed ||= method === 'POST' && path === '/contents/generations/tasks';
    allowed ||=
      method === 'GET' &&
      (path === '/contents/generations/tasks?page_size=1' ||
        /^\/contents\/generations\/tasks\/[A-Za-z0-9_-]{1,160}$/.test(path));
  }
  if (!allowed) throw new RelayError(400, 'INVALID_OPERATION', '不支持此接口或请求方式');
  if (method === 'GET' && Object.hasOwn(envelope, 'body'))
    throw new RelayError(400, 'INVALID_BODY', '查询请求不能包含请求正文');
  const body = envelope.body;
  if (method === 'POST' && !isObject(body))
    throw new RelayError(400, 'INVALID_BODY', '生成请求正文必须是 JSON 对象');
  const target = {
    url: base + path,
    method,
    body: method === 'POST' ? (body as Record<string, unknown>) : undefined,
    image,
  };
  return Object.defineProperty(target, 'apiKey', { value: key, enumerable: false }) as Target;
}

async function forward(target: Target, fetchImpl: FetchImpl, signal: AbortSignal): Promise<Reply> {
  // Only these headers are created; browser cookies and site authorization stay local.
  const response = await fetchImpl(target.url, {
    method: target.method,
    headers: { authorization: `Bearer ${target.apiKey}`, 'content-type': 'application/json' },
    body: target.method === 'POST' ? JSON.stringify(target.body) : undefined,
    redirect: 'error',
    signal,
  });
  const text = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return failure(502, 'UPSTREAM_INVALID_RESPONSE', '供应商未返回有效的 JSON 数据');
  }
  if (!response.ok) {
    let message = '';
    let upstreamCode = '';
    if (isObject(payload)) {
      const { error } = payload;
      message = redactMessage(isObject(error) ? error.message : payload.message, target.apiKey);
      // Keep the provider's code (e.g. a safety-review code) so the client can explain it.
      const code = isObject(error) ? (error.code ?? error.type) : payload.code;
      if (typeof code === 'string' && /^[\w.-]{1,120}$/.test(code)) upstreamCode = code;
    }
    const status = response.status >= 400 && response.status <= 599 ? response.status : 502;
    return failure(
      status,
      `UPSTREAM_${response.status}`,
      message ? `供应商请求失败：${message}` : `供应商请求失败（HTTP ${response.status}）`,
      upstreamCode,
    );
  }
  return { status: response.status, body: text };
}

/** Checks the request, forwards it once, and turns every failure into a reply without the key in it. */
export async function relay(
  envelope: unknown,
  settings: Settings,
  fetchImpl: FetchImpl,
): Promise<Reply> {
  let target: Target;
  try {
    target = validateTarget(envelope);
  } catch (error) {
    if (error instanceof RelayError) return failure(error.status, error.code, error.message);
    throw error;
  }
  const signal = AbortSignal.timeout(target.image ? settings.imageTimeout : settings.queryTimeout);
  try {
    return await forward(target, fetchImpl, signal);
  } catch (error) {
    const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
    if (signal.aborted || (typeof code === 'string' && UPSTREAM_TIMEOUT_CODES.has(code)))
      return failure(504, 'UPSTREAM_TIMEOUT', TIMEOUT_MESSAGE);
    // Upstream errors can carry request details (and keys). Keep them opaque.
    return failure(502, 'UPSTREAM_UNAVAILABLE', UNAVAILABLE_MESSAGE);
  }
}
