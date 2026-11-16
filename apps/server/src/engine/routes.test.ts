import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { createApp } from '../app.ts';
import { createSettings } from '../config.ts';
import type { FetchImpl } from '../relay.ts';

const KEY = 'test-only-key';
const PNG = 'iVBORw0KGgo=';
const TASK = {
  id: 'task-1',
  provider: 'ark',
  baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  model: 'model',
  request: { prompt: 'a cat', size: '1K' },
  context: { card: 7 },
  apiKey: KEY,
};

async function withServer(fetchImpl: FetchImpl, run: (base: string, dir: string) => Promise<void>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'frameout-routes-'));
  const app = createApp(createSettings({ tasksDirectory: dir }), { fetch: fetchImpl });
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${(server.address() as { port: number }).port}`, dir);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

// Raw node:http, as in server.test.ts, so the result comes back as bytes.
function call(base: string, target: string, body?: unknown) {
  return new Promise<{ status: number; type: string; bytes: Buffer; json: () => any }>(
    (resolve, reject) => {
      const method = body === undefined ? 'GET' : 'POST';
      const headers = { 'content-type': 'application/json' };
      const req = http.request(base, { path: target, method, headers, agent: false }, res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const bytes = Buffer.concat(chunks);
          const type = res.headers['content-type'] ?? '';
          resolve({ status: res.statusCode ?? 0, type, bytes, json: () => JSON.parse(`${bytes}`) });
        });
      });
      req.on('error', reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    },
  );
}

/** Opens the event stream and hands each event to `until` until it returns true. */
function events(base: string, until: (event: any) => boolean) {
  return new Promise<void>((resolve, reject) => {
    http
      .get(`${base}/api/tasks/events`, { agent: false }, res => {
        let buffer = '';
        res.setEncoding('utf8').on('data', chunk => {
          buffer += chunk;
          const parts = buffer.split('\n\n');
          buffer = parts.pop()!;
          for (const part of parts) {
            if (!until(JSON.parse(part.replace(/^data: /, '')))) continue;
            res.destroy();
            return resolve();
          }
        });
      })
      .on('error', reject);
  });
}

const noUpstream: FetchImpl = () => {
  throw new Error('Rejected requests must not contact a provider');
};

test('a task without a key, with a bad id or at another address is refused', async () => {
  await withServer(noUpstream, async base => {
    const refused = async (change: object, status: number, code: string) => {
      const response = await call(base, '/api/tasks', { ...TASK, ...change });
      assert.equal(response.status, status, code);
      assert.equal(response.json().error.code, code);
    };
    await refused({ apiKey: undefined }, 401, 'MISSING_API_KEY');
    await refused({ id: '../escape' }, 400, 'INVALID_TASK');
    await refused({ baseUrl: 'https://example.com/v1' }, 400, 'INVALID_BASE_URL');
    assert.deepEqual((await call(base, '/api/tasks')).json(), { tasks: [] });
  });
});

test('a finished image is announced, served, and deleted on ack; the key never reaches disk', async () => {
  const upstream: FetchImpl = async () =>
    new Response(JSON.stringify({ data: [{ b64_json: PNG }] }), { status: 200 });
  await withServer(upstream, async (base, dir) => {
    const seen: any[] = [];
    let subscribed!: () => void;
    const snapshot = new Promise<void>(resolve => (subscribed = resolve));
    const done = events(base, event => {
      seen.push(event);
      subscribed();
      return event.type === 'task' && event.task.status === 'succeeded';
    });
    await snapshot;
    assert.equal((await call(base, '/api/tasks', TASK)).status, 200);
    await done;
    assert.deepEqual(seen[0], { type: 'snapshot', tasks: [] });
    assert.deepEqual(seen.at(-1).task.context, { card: 7 });
    assert.equal((await fs.readFile(path.join(dir, 'task-1.json'), 'utf8')).includes(KEY), false);

    const result = await call(base, '/api/tasks/task-1/result');
    assert.equal(result.type, 'image/png');
    assert.deepEqual(result.bytes, Buffer.from(PNG, 'base64'));

    assert.equal((await call(base, '/api/tasks/task-1/ack', {})).status, 200);
    assert.deepEqual(await fs.readdir(dir), []);
    assert.equal((await call(base, '/api/tasks/task-1/result')).status, 404);
  });
});
