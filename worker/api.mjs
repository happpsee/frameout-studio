/* FRAMEOUT: request-scoped BYOK relay. Provider payloads remain unchanged. */
const REQUEST_LIMIT = 16 * 1024 * 1024;
const RESPONSE_LIMIT = 32 * 1024 * 1024;
const BASES = {
  openai: 'https://api.openai.com/v1',
  ark: 'https://ark.cn-beijing.volces.com/api/v3',
};
const SAFE_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store, max-age=0',
  pragma: 'no-cache',
  'x-content-type-options': 'nosniff',
};

class RelayError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function failure(status, code, message) {
  return new Response(JSON.stringify({ error: { code, message } }), { status, headers: SAFE_HEADERS });
}

export function redactMessage(value, apiKey = '') {
  let message = typeof value === 'string' ? value : '';
  if (apiKey) {
    for (const secret of new Set([apiKey, encodeURIComponent(apiKey)])) {
      message = message.split(secret).join('[已隐藏]');
    }
  }
  return message.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 400);
}

export function validateTarget(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new RelayError(400, 'INVALID_REQUEST', '请求格式不正确');
  }
  const { provider, baseUrl, apiKey, path, method } = envelope;
  if (!Object.hasOwn(BASES, provider)) throw new RelayError(400, 'UNSUPPORTED_PROVIDER', '此转发仅支持 OpenAI 和火山方舟官方接口');
  if (typeof baseUrl !== 'string') throw new RelayError(400, 'INVALID_BASE_URL', '请填写官方 Base URL');
  let parsed;
  try { parsed = new URL(baseUrl); } catch (_) { throw new RelayError(400, 'INVALID_BASE_URL', 'Base URL 格式不正确'); }
  const normalized = parsed.origin + parsed.pathname.replace(/\/$/, '');
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || normalized !== BASES[provider]) {
    throw new RelayError(400, 'INVALID_BASE_URL', '转发地址必须是所选供应商的官方 Base URL；自定义接口请使用浏览器直连');
  }
  if (typeof apiKey !== 'string' || !apiKey.length) throw new RelayError(401, 'MISSING_API_KEY', '请先填写 API Key');
  if (apiKey.length > 4096 || /[^\x21-\x7e]/.test(apiKey)) throw new RelayError(400, 'INVALID_API_KEY', 'API Key 不能包含空白或控制字符');
  if (typeof path !== 'string' || !['GET', 'POST'].includes(method)) throw new RelayError(400, 'INVALID_OPERATION', '不支持此接口或请求方式');
  let allowed = method === 'POST' && path === '/images/generations';
  if (provider === 'openai') allowed ||= method === 'GET' && path === '/models';
  if (provider === 'ark') {
    allowed ||= method === 'POST' && path === '/contents/generations/tasks';
    allowed ||= method === 'GET' && path === '/contents/generations/tasks?page_size=1';
    allowed ||= method === 'GET' && /^\/contents\/generations\/tasks\/[A-Za-z0-9_-]{1,160}$/.test(path);
  }
  if (!allowed) throw new RelayError(400, 'INVALID_OPERATION', '不支持此接口或请求方式');
  if (method === 'GET' && envelope.body !== undefined) throw new RelayError(400, 'INVALID_BODY', '查询请求不能包含请求正文');
  if (method === 'POST' && (!envelope.body || typeof envelope.body !== 'object' || Array.isArray(envelope.body))) {
    throw new RelayError(400, 'INVALID_BODY', '生成请求正文必须是 JSON 对象');
  }
  return { url: BASES[provider] + path, apiKey, method, body: envelope.body, image: path === '/images/generations' };
}

async function readLimited(stream, contentLength, limit, signal) {
  if (contentLength !== null && contentLength !== undefined) {
    if (!/^\d+$/.test(contentLength)) throw new RelayError(400, 'INVALID_LENGTH', '请求长度格式不正确');
    if (Number(contentLength) > limit) throw new RelayError(413, 'BODY_TOO_LARGE', '数据过大，请减小图片或请求大小后重试');
  }
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks = [];
  let length = 0;
  const abort = () => { reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel().catch(() => {});
        throw new RelayError(413, 'BODY_TOO_LARGE', '数据过大，请减小图片或请求大小后重试');
      }
      chunks.push(value);
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    reader.releaseLock();
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

function isJSON(contentType) {
  return /^application\/(?:json|[A-Za-z0-9!#$&^_.+-]+\+json)(?:\s*;|$)/i.test(contentType || '');
}

export async function handleAI(request, { fetchImpl = fetch, timeoutMs } = {}) {
  const ownURL = new URL(request.url);
  if (ownURL.pathname !== '/api/ai') return failure(404, 'NOT_FOUND', '接口不存在');
  if (request.method !== 'POST') return failure(405, 'METHOD_NOT_ALLOWED', '请使用 POST 请求');
  const origin = request.headers.get('origin');
  if ((origin !== null && origin !== ownURL.origin) || request.headers.get('sec-fetch-site')?.toLowerCase() === 'cross-site') {
    return failure(403, 'CROSS_ORIGIN_BLOCKED', '只允许从本站发起请求');
  }
  if (!isJSON(request.headers.get('content-type'))) return failure(415, 'INVALID_CONTENT_TYPE', '请使用 application/json 请求');
  if (request.signal.aborted) return failure(499, 'REQUEST_ABORTED', '请求已停止');
  let target;
  try {
    const bytes = await readLimited(request.body, request.headers.get('content-length'), REQUEST_LIMIT, request.signal);
    let envelope;
    try { envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch (_) { throw new RelayError(400, 'INVALID_JSON', '请求正文不是有效的 JSON'); }
    target = validateTarget(envelope);
  } catch (error) {
    if (request.signal.aborted) return failure(499, 'REQUEST_ABORTED', '请求已停止');
    if (error instanceof RelayError) return failure(error.status, error.code, error.message);
    return failure(400, 'INVALID_REQUEST', '无法读取请求');
  }

  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  request.signal.addEventListener('abort', abort, { once: true });
  if (request.signal.aborted) controller.abort();
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : target.image ? 300000 : 90000);
  try {
    const upstream = await fetchImpl(target.url, {
      method: target.method,
      headers: { authorization: `Bearer ${target.apiKey}`, 'content-type': 'application/json' },
      ...(target.method === 'POST' ? { body: JSON.stringify(target.body) } : {}),
      credentials: 'omit',
      redirect: 'error',
      signal: controller.signal,
    });
    if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if (upstream.redirected || (upstream.status >= 300 && upstream.status < 400)) {
      return failure(502, 'UPSTREAM_REDIRECT', '供应商返回了重定向，本站未继续转发');
    }
    const contentType = upstream.headers.get('content-type');
    if (!isJSON(contentType)) return failure(502, 'UPSTREAM_INVALID_RESPONSE', '供应商未返回有效的 JSON 数据');
    let bytes;
    try { bytes = await readLimited(upstream.body, upstream.headers.get('content-length'), RESPONSE_LIMIT, controller.signal); }
    catch (error) {
      if (error instanceof RelayError) return failure(502, 'UPSTREAM_RESPONSE_TOO_LARGE', '供应商响应过大，本站无法接收');
      throw error;
    }
    if (!upstream.ok) {
      let message = '';
      try {
        const data = JSON.parse(new TextDecoder().decode(bytes));
        message = redactMessage(data?.error?.message || data?.message, target.apiKey);
      } catch (_) { /* Never echo an unstructured upstream response. */ }
      return failure(upstream.status >= 400 && upstream.status <= 599 ? upstream.status : 502, `UPSTREAM_${upstream.status}`, message ? `供应商请求失败：${message}` : `供应商请求失败（HTTP ${upstream.status}）`);
    }
    // Keep a successful provider JSON body byte-for-byte intact; do not forward its cookies or cache headers.
    return new Response(bytes, { status: upstream.status, headers: SAFE_HEADERS });
  } catch (_) {
    if (request.signal.aborted) return failure(499, 'REQUEST_ABORTED', '请求已停止');
    if (timedOut) return failure(504, 'UPSTREAM_TIMEOUT', '供应商响应超时，未自动重试；已提交的生成请求可能仍在处理中');
    return failure(502, 'UPSTREAM_UNAVAILABLE', '无法连接供应商，请检查接口状态后重试');
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener('abort', abort);
  }
}
