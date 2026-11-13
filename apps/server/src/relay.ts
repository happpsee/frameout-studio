// A bounded, request-scoped relay for the two supported official providers.
//
// Do not log envelopes or upstream errors: they may contain the caller's key.
// No redirects, retries, cookies, incoming authorization headers, or response cache.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { OFFICIAL_BASE_URLS, type ApiErrorBody, type OfficialProvider } from '@frameout/shared';
import type { Settings } from './config.ts';

export const SAFE_HEADERS = Object.freeze({
  'cache-control': 'no-store, max-age=0',
  pragma: 'no-cache',
  'x-content-type-options': 'nosniff',
});
const JSON_CONTENT = /^application\/(?:json|[A-Za-z0-9!#$&^_.+-]+\+json)(?:\s*;|$)/i;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const UPSTREAM_TIMEOUT_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);
const TIMEOUT_MESSAGE = '供应商响应超时，未自动重试；已提交的生成请求可能仍在处理中';
const UNAVAILABLE_MESSAGE = '无法连接供应商，请检查接口状态后重试';
const TOO_LARGE_MESSAGE = '数据过大，请减小图片或请求大小后重试';
const UPSTREAM_TOO_LARGE_MESSAGE = '供应商响应过大，本站无法接收';

export interface Reply {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
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

class ClientDisconnect extends Error {}

export function failure(
  status: number,
  code: string,
  message: string,
  upstreamCode?: string,
): Reply {
  const body: ApiErrorBody = {
    error: { code, message, ...(upstreamCode ? { upstreamCode } : {}) },
  };
  return {
    status,
    headers: { ...SAFE_HEADERS, 'content-type': 'application/json' },
    body: Buffer.from(JSON.stringify(body)),
  };
}

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

export function validateTarget(envelope: unknown): Target {
  if (!isObject(envelope)) throw new RelayError(400, 'INVALID_REQUEST', '请求格式不正确');
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
  const key = envelope.apiKey;
  if (typeof key !== 'string' || !key)
    throw new RelayError(401, 'MISSING_API_KEY', '请先填写 API Key');
  if (key.length > 4096 || /[^\x21-\x7e]/.test(key))
    throw new RelayError(400, 'INVALID_API_KEY', 'API Key 不能包含空白或控制字符');
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

export function checkLength(
  value: string | null | undefined,
  limit: number,
  upstream = false,
): void {
  if (value === undefined || value === null) return;
  if (!/^[0-9]+$/.test(value)) {
    throw new RelayError(
      upstream ? 502 : 400,
      upstream ? 'UPSTREAM_INVALID_RESPONSE' : 'INVALID_LENGTH',
      '数据长度格式不正确',
    );
  }
  // Compare digit length before conversion to avoid pathological integer strings.
  const normalized = value.replace(/^0+/, '') || '0';
  if (normalized.length > String(limit).length || Number(normalized) > limit) {
    throw upstream
      ? new RelayError(502, 'UPSTREAM_RESPONSE_TOO_LARGE', UPSTREAM_TOO_LARGE_MESSAGE)
      : new RelayError(413, 'BODY_TOO_LARGE', TOO_LARGE_MESSAGE);
  }
}

function decodeJson(bytes: Uint8Array): unknown {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  // Reject NaN/Infinity and numbers that overflow to Infinity (e.g. 1e10000).
  return JSON.parse(text, (_key, value: unknown) => {
    if (typeof value === 'number' && !Number.isFinite(value))
      throw new Error('Non-finite JSON number');
    return value;
  });
}

function readEnvelope(req: IncomingMessage, settings: Settings): Promise<unknown> {
  if (!JSON_CONTENT.test(req.headers['content-type'] ?? '')) {
    return Promise.reject(
      new RelayError(415, 'INVALID_CONTENT_TYPE', '请使用 application/json 请求'),
    );
  }
  try {
    checkLength(req.headers['content-length'], settings.requestLimit);
  } catch (error) {
    return Promise.reject(error);
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      req.off('data', onData).off('end', onEnd).off('error', onAbort).off('close', onClose);
      finish();
    };
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > settings.requestLimit) {
        // Stop buffering; the response closes the connection instead of draining the rest.
        req.pause();
        settle(() => reject(new RelayError(413, 'BODY_TOO_LARGE', TOO_LARGE_MESSAGE)));
      } else {
        chunks.push(chunk);
      }
    };
    const onEnd = () => {
      let envelope: unknown;
      try {
        envelope = decodeJson(Buffer.concat(chunks, size));
      } catch {
        settle(() => reject(new RelayError(400, 'INVALID_JSON', '请求正文不是有效的 JSON')));
        return;
      }
      settle(() => resolve(envelope));
    };
    const onAbort = () => settle(() => reject(new ClientDisconnect()));
    const onClose = () => {
      if (!req.complete) onAbort();
    };
    req.on('data', onData).on('end', onEnd).on('error', onAbort).on('close', onClose);
  });
}

async function readLimited(response: Response, limit: number): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) {
      await response.body.cancel().catch(() => {});
      throw new RelayError(502, 'UPSTREAM_RESPONSE_TOO_LARGE', UPSTREAM_TOO_LARGE_MESSAGE);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

async function forward(
  target: Target,
  settings: Settings,
  fetchImpl: FetchImpl,
  signal: AbortSignal,
): Promise<Reply> {
  // Only these headers are created; browser cookies and site authorization stay local.
  const response = await fetchImpl(target.url, {
    method: target.method,
    headers: { authorization: `Bearer ${target.apiKey}`, 'content-type': 'application/json' },
    body: target.method === 'POST' ? JSON.stringify(target.body) : undefined,
    redirect: 'manual',
    signal,
  });
  const discard = () => response.body?.cancel().catch(() => {});
  if (REDIRECTS.has(response.status)) {
    await discard();
    return failure(502, 'UPSTREAM_REDIRECT', '供应商返回了重定向，本站未继续转发');
  }
  if (!JSON_CONTENT.test(response.headers.get('content-type') ?? '')) {
    await discard();
    return failure(502, 'UPSTREAM_INVALID_RESPONSE', '供应商未返回有效的 JSON 数据');
  }
  try {
    checkLength(response.headers.get('content-length'), settings.responseLimit, true);
  } catch (error) {
    await discard();
    throw error;
  }
  const data = await readLimited(response, settings.responseLimit);
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data));
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
  return {
    status: response.status,
    headers: { ...SAFE_HEADERS, 'content-type': 'application/json' },
    body: data,
  };
}

const TIMEOUT = Symbol('timeout');
const DISCONNECT = Symbol('disconnect');

/** Resolves to a reply, or null when the client has gone away. */
export async function handleAi(
  req: IncomingMessage,
  res: ServerResponse,
  settings: Settings,
  fetchImpl: FetchImpl,
): Promise<Reply | null> {
  const { origin } = req.headers;
  if (
    (origin !== undefined && !settings.allowedOrigins.has(origin)) ||
    (origin === undefined &&
      String(req.headers['sec-fetch-site'] ?? '').toLowerCase() === 'cross-site')
  ) {
    return failure(403, 'CROSS_ORIGIN_BLOCKED', '只允许从已配置的前端地址发起请求');
  }
  let target: Target;
  try {
    target = validateTarget(await readEnvelope(req, settings));
  } catch (error) {
    if (error instanceof ClientDisconnect) return null;
    if (error instanceof RelayError) {
      // A rejected oversized body may still be arriving; don't keep the connection.
      if (!req.complete) res.setHeader('connection', 'close');
      return failure(error.status, error.code, error.message);
    }
    throw error;
  }
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(TIMEOUT),
    target.image ? settings.imageTimeout : settings.queryTimeout,
  );
  const onClose = () => {
    if (!res.writableEnded) controller.abort(DISCONNECT);
  };
  res.on('close', onClose);
  try {
    return await forward(target, settings, fetchImpl, controller.signal);
  } catch (error) {
    if (controller.signal.reason === DISCONNECT) return null;
    const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
    if (
      controller.signal.reason === TIMEOUT ||
      (typeof code === 'string' && UPSTREAM_TIMEOUT_CODES.has(code))
    ) {
      return failure(504, 'UPSTREAM_TIMEOUT', TIMEOUT_MESSAGE);
    }
    if (error instanceof RelayError) return failure(error.status, error.code, error.message);
    // Upstream errors can carry request details (and keys). Keep them opaque.
    return failure(502, 'UPSTREAM_UNAVAILABLE', UNAVAILABLE_MESSAGE);
  } finally {
    clearTimeout(timer);
    res.off('close', onClose);
    if (!controller.signal.aborted) controller.abort();
  }
}
