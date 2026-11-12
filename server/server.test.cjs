'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { inspect } = require('node:util');
const test = require('node:test');
const { createApp } = require('./app.cjs');
const { createSettings, settingsFromEnv } = require('./config.cjs');
const { RelayError, redactMessage, validateTarget } = require('./relay.cjs');

const KEY = 'test-only-key/+?=';
const BASE = {
  provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: KEY,
  path: '/images/generations', method: 'POST', body: { model: 'test-image', prompt: 'fixture' },
};
const ARK = { ...BASE, provider: 'ark', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', path: '/contents/generations/tasks' };
const without = (value, key) => Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));

function noUpstream() {
  throw new Error('Rejected requests must not contact a provider');
}

function jsonResponse(status, value, headers = {}) {
  return new Response(typeof value === 'string' ? value : JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'frameout-server-'));
}

async function withServer(overrides, fetchImpl, run) {
  const server = http.createServer(createApp(createSettings(overrides), { fetch: fetchImpl }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    return await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

// Raw node:http so tests control every header (fetch would add its own).
function request(base, { method = 'GET', path: target = '/', headers = {}, body, chunked = false } = {}) {
  return new Promise((resolve, reject) => {
    // Pass the path separately: a full URL string would be normalized ("%2e%2e" → "..").
    const req = http.request(base, { path: target, method, headers, agent: false }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) });
      });
    });
    req.on('error', reject);
    if (body !== undefined) {
      if (chunked) {
        for (let i = 0; i < body.length; i += 100) req.write(body.slice(i, i + 100));
      } else {
        req.write(body);
      }
    }
    req.end();
  });
}

function post(base, envelope, headers = {}) {
  const body = JSON.stringify(envelope);
  return request(base, { method: 'POST', path: '/api/ai', headers: { 'content-type': 'application/json', ...headers }, body });
}

test('health and unknown API paths never return the SPA', async () => {
  const dist = tempDir();
  fs.writeFileSync(path.join(dist, 'index.html'), '<html>FRAMEOUT</html>');
  fs.mkdirSync(path.join(dist, 'assets'));
  fs.writeFileSync(path.join(dist, 'assets', 'app.js'), 'export const ok = true;');
  const outside = tempDir();
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(dist, 'assets', 'link.txt'));
  await withServer({ frontendDist: dist }, noUpstream, async base => {
    assert.deepEqual((await request(base, { path: '/api/health' })).json(), { status: 'ok', service: 'frameout-api' });
    assert.equal((await request(base)).text, '<html>FRAMEOUT</html>');
    const spa = await request(base, { path: '/studio/project' });
    assert.equal(spa.text, '<html>FRAMEOUT</html>');
    assert.equal(spa.headers['cache-control'], 'no-cache');
    const asset = await request(base, { path: '/assets/app.js' });
    assert.equal(asset.status, 200);
    assert.match(asset.headers['content-type'], /^text\/javascript/);
    assert.equal((await request(base, { path: '/assets/missing.js' })).status, 404);
    for (const target of ['/api', '/api/unknown', '/.env', '/assets/%2e%2e/%2e%2e/secret', '/assets/..%2f..%2fsecret', '/assets/link.txt', '/%E0%A4%A']) {
      const response = await request(base, { path: target });
      assert.equal(response.status, 404, target);
      assert.match(response.headers['content-type'], /^application\/json/, target);
    }
    assert.equal((await request(base, { path: '/api/ai' })).status, 405);
    assert.equal((await request(base, { method: 'DELETE', path: '/' })).status, 405);
  });
});

test('a missing build is reported clearly', async () => {
  await withServer({ frontendDist: tempDir() }, noUpstream, async base => {
    assert.equal((await request(base)).json().error.code, 'FRONTEND_NOT_BUILT');
  });
});

test('base URL allowlist', () => {
  for (const baseUrl of [
    'http://api.openai.com/v1', 'https://evil.example/v1', 'https://api.openai.com.evil.example/v1',
    'https://api.openai.com/v1?key=123', 'https://api.openai.com/v1#fragment',
    'https://user:pass@api.openai.com/v1', 'https://127.0.0.1/v1', 'https://api.openai.com:8443/v1',
    'https://api.openai.com/v1%2f', 'https://api.openai.com/v1/../admin', [], null,
  ]) {
    assert.throws(() => validateTarget({ ...BASE, baseUrl }), error => error instanceof RelayError && error.code === 'INVALID_BASE_URL', String(baseUrl));
  }
});

test('trailing slash and provider allowlist', () => {
  assert.equal(validateTarget({ ...BASE, baseUrl: `${BASE.baseUrl}/` }).url, BASE.baseUrl + BASE.path);
  for (const provider of ['compatible', '__proto__', 'toString', [], null]) {
    assert.throws(() => validateTarget({ ...BASE, provider }), RelayError);
  }
  const target = validateTarget(BASE);
  assert.ok(!inspect(target).includes(KEY));
  assert.ok(!JSON.stringify(target).includes(KEY));
});

test('path allowlist', () => {
  for (const target of [
    '/videos', '/images/generations?x=1', '//api.openai.com/v1/models', '/images/../models',
    '/images%2fgenerations', '/contents/generations/tasks/x?url=http://127.0.0.1',
    '/contents/generations/tasks/../models', '/contents/generations/tasks/%2e%2e',
    '/contents/generations/tasks?page_size=1&x=y', '/images/edits',
  ]) {
    assert.throws(() => validateTarget({ ...ARK, path: target }), RelayError, target);
  }
});

test('permitted paths and body validation', () => {
  const models = without({ ...BASE, path: '/models', method: 'GET' }, 'body');
  assert.equal(validateTarget(models).method, 'GET');
  assert.ok(validateTarget({ ...ARK, path: '/images/generations' }).image);
  const edit = validateTarget({ ...BASE, path: '/images/edits' });
  assert.ok(edit.image);
  assert.equal(edit.url, 'https://api.openai.com/v1/images/edits');
  for (const method of ['GET', 'PUT']) {
    assert.throws(() => validateTarget(without({ ...BASE, path: '/images/edits', method }, 'body')), RelayError);
  }
  for (const target of ['/contents/generations/tasks?page_size=1', '/contents/generations/tasks/cgt-123_test']) {
    assert.equal(validateTarget(without({ ...ARK, path: target, method: 'GET' }, 'body')).method, 'GET');
  }
  for (const envelope of [{ ...BASE, method: 'DELETE' }, { ...models, body: null }, { ...BASE, body: [] }, [], null]) {
    assert.throws(() => validateTarget(envelope), RelayError);
  }
});

test('key validation never reaches upstream', async () => {
  await withServer({}, noUpstream, async base => {
    for (const [apiKey, status] of [['', 401], [null, 401], ['abc\r\nX-Test: bad', 400], ['abc def', 400], [' abc', 400], ['密钥', 400], ['a'.repeat(4097), 400]]) {
      assert.equal((await post(base, { ...BASE, apiKey })).status, status, String(apiKey).slice(0, 20));
    }
  });
});

test('origins are exact and CORS is not a wildcard', async () => {
  await withServer({}, noUpstream, async base => {
    for (const headers of [{ origin: 'https://evil.example' }, { origin: 'null' }, { 'sec-fetch-site': 'cross-site' }]) {
      const response = await post(base, BASE, headers);
      assert.equal(response.status, 403);
      assert.equal(response.headers['access-control-allow-origin'], undefined);
    }
    const preflight = await request(base, {
      method: 'OPTIONS', path: '/api/ai',
      headers: { origin: 'http://127.0.0.1:5173', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
    });
    assert.equal(preflight.status, 200);
    assert.equal(preflight.headers['access-control-allow-origin'], 'http://127.0.0.1:5173');
    assert.equal(preflight.headers['access-control-allow-credentials'], undefined);
    const denied = await request(base, {
      method: 'OPTIONS', path: '/api/ai',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
    });
    assert.equal(denied.status, 400);
    assert.equal(denied.headers['access-control-allow-origin'], undefined);
  });
});

test('desktop mode rejects foreign Host headers', async () => {
  await withServer({ allowedHosts: ['127.0.0.1'] }, noUpstream, async base => {
    assert.equal((await request(base, { path: '/api/health' })).status, 200);
    const response = await request(base, { path: '/api/health', headers: { host: 'evil.example' } });
    assert.equal(response.status, 400);
    assert.equal(response.json().error.code, 'INVALID_HOST');
  });
});

test('success is unchanged, single-call, and never forwards browser credentials', async () => {
  const calls = [];
  const raw = '{ "data": [{"url":"https://media.example/result.png"}], "usage":{"tokens":1} }';
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return jsonResponse(200, raw, { 'set-cookie': 'private=do-not-reuse; Path=/', 'cache-control': 'public,max-age=3600' });
  };
  await withServer({}, fetchImpl, async base => {
    for (let i = 0; i < 2; i += 1) {
      const response = await post(base, BASE, { origin: 'http://127.0.0.1:5173', cookie: 'browser=secret', authorization: 'Bearer site-token', 'oai-authenticated-user-id': 'private-user' });
      assert.equal(response.status, 200);
      assert.equal(response.text, raw);
      assert.equal(response.headers['set-cookie'], undefined);
      assert.match(response.headers['cache-control'], /no-store/);
      assert.equal(response.headers['x-content-type-options'], 'nosniff');
    }
  });
  assert.equal(calls.length, 2);
  for (const { url, init } of calls) {
    assert.equal(url, 'https://api.openai.com/v1/images/generations');
    assert.deepEqual(init.headers, { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' });
    assert.equal(init.redirect, 'manual');
    assert.deepEqual(JSON.parse(init.body), BASE.body);
  }
});

test('a video query has no body', async () => {
  const query = without({ ...ARK, path: '/contents/generations/tasks/cgt-123', method: 'GET' }, 'body');
  const fetchImpl = async (url, init) => {
    assert.equal(init.method, 'GET');
    assert.equal(init.body, undefined);
    assert.ok(url.endsWith('/contents/generations/tasks/cgt-123'));
    return jsonResponse(200, { id: 'cgt-123', status: 'succeeded', content: { video_url: 'https://media.example/video.mp4' } });
  };
  await withServer({}, fetchImpl, async base => {
    assert.equal((await post(base, query)).json().status, 'succeeded');
  });
});

test('redirects are never followed or exposed', async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return new Response(null, { status, headers: { location: 'https://evil.example/steal' } });
    };
    await withServer({}, fetchImpl, async base => {
      const response = await post(base, BASE);
      assert.equal(response.status, 502);
      assert.equal(response.json().error.code, 'UPSTREAM_REDIRECT');
      assert.equal(response.headers.location, undefined);
    });
    assert.equal(calls, 1);
  }
});

test('provider errors redact plain and URL-encoded keys', async () => {
  for (const status of [401, 403, 429, 503]) {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return jsonResponse(status, { error: { message: `bad key ${KEY}\nretry ${encodeURIComponent(KEY)}` } });
    };
    await withServer({}, fetchImpl, async base => {
      const response = await post(base, BASE);
      assert.equal(response.status, status);
      assert.ok(!response.text.includes(KEY));
      assert.ok(!response.text.includes(encodeURIComponent(KEY)));
      assert.ok(response.json().error.message.includes('已隐藏'));
    });
    assert.equal(calls, 1);
  }
  assert.equal(redactMessage(` ${KEY}\n${KEY} `, KEY), '[已隐藏] [已隐藏]');
});

test('bad upstream responses do not echo secrets', async () => {
  const handlers = {
    network: async () => { throw new TypeError('fetch failed', { cause: new Error(`private infrastructure ${KEY}`) }); },
    unexpected: async () => { throw new Error(`private infrastructure ${KEY}`); },
    html: async () => new Response(`<html>${KEY}</html>`, { headers: { 'content-type': 'text/html' } }),
    'fake-json': async () => jsonResponse(200, `<html>${KEY}</html>`),
  };
  for (const [kind, fetchImpl] of Object.entries(handlers)) {
    await withServer({}, fetchImpl, async base => {
      const response = await post(base, BASE);
      assert.equal(response.status, 502, kind);
      assert.ok(!response.text.includes(KEY), kind);
      assert.ok(!response.text.includes('private infrastructure'), kind);
    });
  }
});

test('request limits check declared and actual size', async () => {
  await withServer({ requestLimit: 1000 }, noUpstream, async base => {
    const send = (body, headers) => request(base, { method: 'POST', path: '/api/ai', headers, body });
    assert.equal((await send('{}', { 'content-type': 'text/plain' })).status, 415);
    assert.equal((await send('{', { 'content-type': 'application/json' })).json().error.code, 'INVALID_JSON');
    assert.equal((await send(Buffer.from([0x7b, 0xff, 0x7d]), { 'content-type': 'application/json' })).json().error.code, 'INVALID_JSON');
    for (const invalid of ['{"body":NaN}', '{"body":Infinity}', '{"body":{"x":1e10000}}']) {
      assert.equal((await send(invalid, { 'content-type': 'application/json' })).status, 400, invalid);
    }
    assert.equal((await send(JSON.stringify(BASE), { 'content-type': 'application/json', 'content-length': '1001' })).status, 413);
    assert.equal((await send('{}', { 'content-type': 'application/json', 'content-length': '-1' })).status, 400);
    // No declared length: the streamed body itself must be capped.
    const large = JSON.stringify({ ...BASE, body: { prompt: 'a'.repeat(1001) } });
    const chunked = await request(base, { method: 'POST', path: '/api/ai', headers: { 'content-type': 'application/json' }, body: large, chunked: true });
    assert.equal(chunked.status, 413);
  });
});

test('response limits check declared and actual size', async () => {
  for (const declared of [false, true]) {
    const fetchImpl = async () => jsonResponse(200, declared ? '{}' : 'a'.repeat(1001), declared ? { 'content-length': '1001' } : {});
    await withServer({ responseLimit: 1000 }, fetchImpl, async base => {
      const response = await post(base, BASE);
      assert.equal(response.status, 502);
      assert.equal(response.json().error.code, 'UPSTREAM_RESPONSE_TOO_LARGE');
    });
  }
});

function hangingUpstream(state) {
  return (_url, init) => new Promise((_resolve, reject) => {
    state.calls += 1;
    state.started?.();
    init.signal.addEventListener('abort', () => {
      state.cancelled = true;
      reject(init.signal.reason);
    });
  });
}

test('a timeout cancels upstream without repeating a paid POST', async () => {
  const state = { calls: 0, cancelled: false };
  await withServer({ imageTimeout: 20 }, hangingUpstream(state), async base => {
    const response = await post(base, BASE);
    assert.equal(response.status, 504);
    assert.match(response.json().error.message, /未自动重试/);
  });
  assert.equal(state.calls, 1);
  assert.equal(state.cancelled, true);
});

test('a client disconnect cancels the in-flight request', async () => {
  const state = { calls: 0, cancelled: false };
  const started = new Promise(resolve => { state.started = resolve; });
  await withServer({}, hangingUpstream(state), async base => {
    const req = http.request(`${base}/api/ai`, { method: 'POST', headers: { 'content-type': 'application/json' }, agent: false });
    req.on('error', () => {});
    req.end(JSON.stringify(BASE));
    await started;
    req.destroy();
    for (let i = 0; i < 100 && !state.cancelled; i += 1) await new Promise(resolve => setTimeout(resolve, 10));
  });
  assert.equal(state.calls, 1);
  assert.equal(state.cancelled, true);
});

test('the environment only adds exact origins', () => {
  assert.ok(settingsFromEnv({ FRAMEOUT_ALLOWED_ORIGINS: 'https://frameout.example,http://localhost:5199/' }).allowedOrigins.has('https://frameout.example'));
  for (const value of ['https://*.example', 'https://frameout.example/path', 'https://user@frameout.example', 'ftp://frameout.example', 'frameout.example']) {
    assert.throws(() => settingsFromEnv({ FRAMEOUT_ALLOWED_ORIGINS: value }), Error, value);
  }
});
