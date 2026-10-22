import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAI, validateTarget, redactMessage } from '../worker/api.mjs';

const apiKey = 'test-only-provider-key';
const base = { provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey, path: '/images/generations', method: 'POST', body: { model: 'test-image', prompt: 'test fixture only' } };
const ark = { provider: 'ark', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', apiKey, path: '/contents/generations/tasks', method: 'POST', body: { model: 'test-video', content: [{ type: 'text', text: 'test fixture only' }] } };
const request = (envelope = base, extra = {}) => new Request('https://frameout.test/api/ai', { method: 'POST', headers: { 'content-type': 'application/json', ...(extra.headers || {}) }, body: JSON.stringify(envelope), ...extra, ...(extra.headers ? { headers: { 'content-type': 'application/json', ...extra.headers } } : {}) });
const json = (body, extra = {}) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' }, ...extra });
const rejectedFetch = async () => { assert.fail('不应转发此请求'); };

test('仅允许两家官方 Base URL，阻止任意主机、URL 认证和编码绕过', () => {
  for (const baseUrl of ['http://api.openai.com/v1', 'https://evil.example/v1', 'https://api.openai.com.evil.example/v1', 'https://api.openai.com/v1?key=123', 'https://api.openai.com/v1#fragment', 'https://user:pass@api.openai.com/v1', 'https://127.0.0.1/v1', 'https://api.openai.com:8443/v1', 'https://api.openai.com/v1%2f', 'https://api.openai.com/v1/../admin']) {
    assert.throws(() => validateTarget({ ...base, baseUrl }), /Base URL|官方/);
  }
  assert.equal(validateTarget({ ...base, baseUrl: base.baseUrl + '/' }).url, base.baseUrl + base.path);
  assert.throws(() => validateTarget({ ...base, provider: 'compatible' }), /官方/);
  assert.throws(() => validateTarget({ ...base, provider: '__proto__' }), /官方/);
});

test('路径与方法逐条允许，不开放官方已下线视频、删除、任意查询或路径穿越', () => {
  assert.equal(validateTarget({ ...base, path: '/models', method: 'GET', body: undefined }).url, 'https://api.openai.com/v1/models');
  assert.equal(validateTarget({ ...ark, path: '/images/generations' }).url, 'https://ark.cn-beijing.volces.com/api/v3/images/generations');
  assert.equal(validateTarget({ ...ark, path: '/contents/generations/tasks?page_size=1', method: 'GET', body: undefined }).method, 'GET');
  assert.equal(validateTarget({ ...ark, path: '/contents/generations/tasks/cgt-123_test', method: 'GET', body: undefined }).method, 'GET');
  for (const path of ['/videos', '/images/generations?x=1', '//api.openai.com/v1/models', '/images/../models', '/images%2fgenerations', '/contents/generations/tasks/x?url=http://127.0.0.1', '/contents/generations/tasks/../models', '/contents/generations/tasks/%2e%2e', '/contents/generations/tasks?page_size=1&x=y']) {
    assert.throws(() => validateTarget({ ...ark, path }), /不支持/);
  }
  assert.throws(() => validateTarget({ ...base, method: 'DELETE' }), /不支持/);
  assert.throws(() => validateTarget({ ...base, path: '/models' }), /不支持/);
  assert.throws(() => validateTarget({ ...base, path: '/models', method: 'GET' }), /正文/);
  assert.throws(() => validateTarget({ ...base, body: [] }), /JSON/);
});

test('密钥校验拒绝空值与可注入 header 的控制字符', async () => {
  assert.equal((await handleAI(request({ ...base, apiKey: '' }), { fetchImpl: rejectedFetch })).status, 401);
  for (const key of ['abc\r\nX-Test: bad', 'abc def', ' abc', '密钥', 'a'.repeat(4097)]) {
    assert.equal((await handleAI(request({ ...base, apiKey: key }), { fetchImpl: rejectedFetch })).status, 400);
  }
});

test('跨站 Origin 与 Sec-Fetch-Site 被拒绝，不输出宽泛 CORS header', async () => {
  for (const headers of [{ origin: 'https://evil.example' }, { origin: 'null' }, { 'sec-fetch-site': 'cross-site' }]) {
    const result = await handleAI(request(base, { headers }), { fetchImpl: rejectedFetch });
    assert.equal(result.status, 403);
    assert.equal(result.headers.get('access-control-allow-origin'), null);
  }
  assert.equal((await handleAI(new Request('https://frameout.test/api/ai'), { fetchImpl: rejectedFetch })).status, 405);
  assert.equal((await handleAI(new Request('https://frameout.test/other'), { fetchImpl: rejectedFetch })).status, 404);
});

test('成功正文原样返回，付费 POST 只转发一次，且不传用户 cookie 或站点身份', async () => {
  let calls = 0;
  const raw = '{ "data": [{"url":"https://media.example/result.png"}], "usage": {"tokens":1} }';
  const result = await handleAI(request(base, { headers: { origin: 'https://frameout.test', cookie: 'private-session=secret', authorization: 'Bearer site-token', 'oai-authenticated-user-id': 'private-user', 'sec-fetch-site': 'same-origin' } }), { fetchImpl: async (url, init) => {
    calls++;
    assert.equal(url, 'https://api.openai.com/v1/images/generations');
    assert.equal(init.method, 'POST');
    assert.deepEqual(init.headers, { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' });
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'error');
    assert.deepEqual(JSON.parse(init.body), base.body);
    return new Response(raw, { headers: { 'content-type': 'application/json', 'set-cookie': 'bad=1', 'cache-control': 'public,max-age=3600', 'access-control-allow-origin': '*' } });
  } });
  assert.equal(calls, 1);
  assert.equal(await result.text(), raw);
  assert.equal(result.headers.get('set-cookie'), null);
  assert.equal(result.headers.get('access-control-allow-origin'), null);
  assert.match(result.headers.get('cache-control'), /no-store/);
  assert.equal(result.headers.get('x-content-type-options'), 'nosniff');
});

test('查询只转发 GET，不携带正文，Ark 成功结构保持供应商协议', async () => {
  const payload = { id: 'cgt-123', status: 'succeeded', content: { video_url: 'https://media.example/video.mp4' } };
  const result = await handleAI(request({ ...ark, path: '/contents/generations/tasks/cgt-123', method: 'GET', body: undefined }), { fetchImpl: async (url, init) => {
    assert.equal(url, 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/cgt-123');
    assert.equal(init.method, 'GET');
    assert.equal(Object.hasOwn(init, 'body'), false);
    return json(payload);
  } });
  assert.deepEqual(await result.json(), payload);
});

test('上游鉴权/限流错误保留 HTTP 状态但脱敏 key，不自动重试', async () => {
  for (const status of [401, 403, 429, 503]) {
    let calls = 0;
    const result = await handleAI(request(), { fetchImpl: async () => { calls++; return json({ error: { message: `bad key ${apiKey}\nretry ${encodeURIComponent(apiKey)}` } }, { status }); } });
    assert.equal(result.status, status);
    assert.equal(calls, 1);
    const text = await result.text();
    assert.equal(text.includes(apiKey), false);
    assert.match(text, /已隐藏/);
  }
  assert.equal(redactMessage(` ${apiKey}\n${apiKey} `, apiKey), '[已隐藏] [已隐藏]');
});

test('网络异常、重定向与 HTML 响应不会泄露正文或错误细节', async () => {
  for (const fetchImpl of [async () => { throw new Error(`private infrastructure: ${apiKey}`); }, async () => new Response('', { status: 302, headers: { location: 'https://evil.example/' } }), async () => new Response(`<p>${apiKey}</p>`, { headers: { 'content-type': 'text/html' } })]) {
    const result = await handleAI(request(), { fetchImpl });
    assert.equal(result.status, 502);
    const text = await result.text();
    assert.equal(text.includes(apiKey), false);
    assert.equal(text.includes('private infrastructure'), false);
  }
});

test('请求类型与错误 JSON 有明确错误；请求体按头和实际流双重限额', async () => {
  const wrong = await handleAI(request(base, { headers: { 'content-type': 'text/plain' } }), { fetchImpl: rejectedFetch });
  assert.equal(wrong.status, 415);
  assert.equal((await handleAI(new Request('https://frameout.test/api/ai', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }), { fetchImpl: rejectedFetch })).status, 400);
  assert.equal((await handleAI(request(base, { headers: { 'content-length': String(16 * 1024 * 1024 + 1) } }), { fetchImpl: rejectedFetch })).status, 413);
  assert.equal((await handleAI(request(base, { headers: { 'content-length': '-1' } }), { fetchImpl: rejectedFetch })).status, 400);
  const large = { ...base, body: { prompt: 'a'.repeat(16 * 1024 * 1024) } };
  assert.equal((await handleAI(request(large), { fetchImpl: rejectedFetch })).status, 413);
});

test('上游声明或实际响应超额均中止接收', async () => {
  const declared = await handleAI(request(), { fetchImpl: async () => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': String(32 * 1024 * 1024 + 1) } }) });
  assert.equal(declared.status, 502);
  assert.equal((await declared.json()).error.code, 'UPSTREAM_RESPONSE_TOO_LARGE');
  const chunk = new Uint8Array(1024 * 1024);
  let sent = 0;
  const stream = new ReadableStream({ pull(controller) { if (sent++ < 33) controller.enqueue(chunk); else controller.close(); } });
  const actual = await handleAI(request(), { fetchImpl: async () => new Response(stream, { headers: { 'content-type': 'application/json' } }) });
  assert.equal(actual.status, 502);
  assert.equal((await actual.json()).error.code, 'UPSTREAM_RESPONSE_TOO_LARGE');
});

test('调用前已 Abort 不转发，调用中 Abort 会取消上游且不重试', async () => {
  const before = new AbortController(); before.abort();
  assert.equal((await handleAI(request(base, { signal: before.signal }), { fetchImpl: rejectedFetch })).status, 499);
  const during = new AbortController();
  let calls = 0;
  const pending = handleAI(request(base, { signal: during.signal }), { fetchImpl: async (_, init) => {
    calls++;
    queueMicrotask(() => during.abort());
    return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
  } });
  assert.equal((await pending).status, 499);
  assert.equal(calls, 1);
});

test('上游超时会 Abort，并明确告知没有自动重发生成请求', async () => {
  let cancelled = false;
  const result = await handleAI(request(), { timeoutMs: 5, fetchImpl: async (_, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => { cancelled = true; reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
  }) });
  assert.equal(result.status, 504);
  assert.equal(cancelled, true);
  assert.match((await result.json()).error.message, /未自动重试/);
});
