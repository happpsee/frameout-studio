import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { createApp } from './app.ts';
import { createSettings, type Settings } from './config.ts';
import { RelayError, validateTarget, type FetchImpl } from './relay.ts';

type Envelope = Record<string, unknown>;

const KEY = 'test-only-key/+?=';
const BASE: Envelope = {
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: KEY,
  path: '/images/generations',
  method: 'POST',
  body: { model: 'test-image', prompt: 'fixture' },
};
const noUpstream: FetchImpl = () => {
  throw new Error('Rejected requests must not contact a provider');
};
const json = (status: number, value: unknown) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

async function withServer(
  overrides: Partial<Settings>,
  fetchImpl: FetchImpl,
  run: (base: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer(createApp(createSettings(overrides), { fetch: fetchImpl }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${(server.address() as { port: number }).port}`);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

// Raw node:http, so a test can set Host and Origin (fetch would not allow it).
function request(
  base: string,
  target: string,
  options: { headers?: http.OutgoingHttpHeaders; body?: string } = {},
): Promise<{ status: number; type: string; text: string; json: () => any }> {
  const { headers = {}, body } = options;
  return new Promise((resolve, reject) => {
    const method = body === undefined ? 'GET' : 'POST';
    const req = http.request(base, { path: target, method, headers, agent: false }, res => {
      let text = '';
      res.setEncoding('utf8').on('data', chunk => (text += chunk));
      res.on('end', () =>
        resolve({
          status: res.statusCode ?? 0,
          type: res.headers['content-type'] ?? '',
          text,
          json: () => JSON.parse(text),
        }),
      );
    });
    req.on('error', reject);
    req.end(body);
  });
}
const post = (base: string, envelope: Envelope, headers: http.OutgoingHttpHeaders = {}) =>
  request(base, '/api/ai', {
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(envelope),
  });

test('serves the built UI, pages of the app, and JSON 404s for anything else', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frameout-server-'));
  const dist = path.join(root, 'dist');
  fs.mkdirSync(dist);
  fs.writeFileSync(path.join(root, 'secret.txt'), 'outside the build');
  fs.writeFileSync(path.join(dist, 'index.html'), '<html>FRAMEOUT</html>');
  fs.writeFileSync(path.join(dist, 'app.js'), 'export const ok = true;');
  await withServer({ frontendDist: dist }, noUpstream, async base => {
    assert.equal((await request(base, '/api/health')).json().status, 'ok');
    assert.equal((await request(base, '/')).text, '<html>FRAMEOUT</html>');
    assert.equal((await request(base, '/studio/project')).text, '<html>FRAMEOUT</html>');
    assert.match((await request(base, '/app.js')).type, /javascript/);
    for (const target of ['/api/unknown', '/missing.js', '/..%2fsecret.txt']) {
      const response = await request(base, target);
      assert.equal(response.status, 404, target);
      assert.match(response.type, /^application\/json/, target);
    }
  });
});

test('only official providers, base URLs and known paths can be reached', () => {
  const rejects = (change: Envelope, code: string) =>
    assert.throws(
      () => validateTarget({ ...BASE, ...change }),
      (error: unknown) => error instanceof RelayError && error.code === code,
    );
  assert.equal(validateTarget(BASE).url, 'https://api.openai.com/v1/images/generations');
  rejects({ provider: 'compatible' }, 'UNSUPPORTED_PROVIDER');
  rejects({ baseUrl: 'https://example.com/v1' }, 'INVALID_BASE_URL');
  rejects({ baseUrl: 'https://api.openai.com.evil.test/v1' }, 'INVALID_BASE_URL');
  rejects({ path: '/files' }, 'INVALID_OPERATION');
  rejects({ path: '/images/generations/../files' }, 'INVALID_OPERATION');
  rejects({ method: 'DELETE' }, 'INVALID_OPERATION');
  rejects({ apiKey: '' }, 'MISSING_API_KEY');
  rejects({ apiKey: 'a b' }, 'INVALID_API_KEY');
});

test('forwards once, with the key and nothing from the browser', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const upstream: FetchImpl = async (url, init) => {
    calls.push({ url, init });
    return json(200, { data: [{ b64_json: 'aW1hZ2U=' }] });
  };
  await withServer({}, upstream, async base => {
    const response = await post(base, BASE, { cookie: 'session=1', authorization: 'Bearer site' });
    assert.equal(response.status, 200);
    assert.deepEqual(response.json(), { data: [{ b64_json: 'aW1hZ2U=' }] });
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.openai.com/v1/images/generations');
  assert.deepEqual(calls[0].init.headers, {
    authorization: `Bearer ${KEY}`,
    'content-type': 'application/json',
  });
  assert.equal(calls[0].init.redirect, 'error');
});

test('a provider error keeps its status and code, and never shows the key', async () => {
  const message = `bad key ${KEY} and ${encodeURIComponent(KEY)}`;
  const upstream: FetchImpl = async () =>
    json(400, { error: { code: 'moderation_blocked', message } });
  await withServer({}, upstream, async base => {
    const response = await post(base, BASE);
    assert.equal(response.status, 400);
    assert.equal(response.json().error.upstreamCode, 'moderation_blocked');
    assert.equal(response.text.includes(KEY), false);
    assert.equal(response.text.includes(encodeURIComponent(KEY)), false);
  });
});

test('a timeout is reported without sending the paid request again', async () => {
  let calls = 0;
  const upstream: FetchImpl = (_url, init) =>
    new Promise((_resolve, reject) => {
      calls++;
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    });
  await withServer({ imageTimeout: 30 }, upstream, async base => {
    const response = await post(base, BASE);
    assert.equal(response.status, 504);
    assert.equal(response.json().error.code, 'UPSTREAM_TIMEOUT');
  });
  assert.equal(calls, 1);
});

test('a page on another site cannot call the API', async () => {
  await withServer(
    {},
    async () => json(200, {}),
    async base => {
      assert.equal((await post(base, BASE, { origin: 'https://evil.test' })).status, 403);
      assert.equal((await post(base, BASE, { origin: base })).status, 200);
    },
  );
});

test('desktop mode rejects a Host that is not the loopback address', async () => {
  await withServer({ allowedHosts: ['127.0.0.1'] }, noUpstream, async base => {
    assert.equal(
      (await request(base, '/api/health', { headers: { host: 'evil.test' } })).status,
      400,
    );
    assert.equal((await request(base, '/api/health')).status, 200);
  });
});

test('a request over the size limit is refused before reaching a provider', async () => {
  await withServer({ requestLimit: 1000 }, noUpstream, async base => {
    const response = await post(base, { ...BASE, body: { prompt: 'x'.repeat(2000) } });
    assert.equal(response.status, 413);
    assert.equal(response.json().error.code, 'BODY_TOO_LARGE');
  });
});
