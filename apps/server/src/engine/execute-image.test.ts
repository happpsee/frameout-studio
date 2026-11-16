import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { createImageExecutor, type ImageExecutorOptions } from './execute-image.ts';
import type { Task } from './task.ts';

const ARK = 'https://ark.cn-beijing.volces.com/api/v3';
const PNG = 'iVBORw0KGgo=';
const task: Task = {
  id: 'a',
  kind: 'image',
  provider: 'ark',
  baseUrl: ARK,
  model: 'model',
  request: { prompt: 'a cat', size: '1K' },
  status: 'running',
  createdAt: 1,
};
const json = (status: number, value: unknown) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

/** Runs the task once against a fake provider; `replies` are used in order, one per call. */
async function run(replies: ImageExecutorOptions['fetchImpl'][], timeoutMs = 1000) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'frameout-execute-'));
  let calls = 0;
  const execute = createImageExecutor({
    directory,
    timeoutMs,
    fetchImpl: (url, init) => replies[calls++]!(url, init),
  });
  return {
    outcome: await execute(task, { key: 'test-only-key', update: async () => {} }),
    calls: () => calls,
    directory,
  };
}

test('a 429 is retried, then the image is saved', async () => {
  const { outcome, calls, directory } = await run([
    async () => json(429, { error: { code: 'RateLimitExceeded', message: 'slow down' } }),
    async () => json(200, { data: [{ b64_json: PNG }] }),
  ]);
  assert.deepEqual(outcome, {
    status: 'succeeded',
    result: { file: 'a.result', mime: 'image/png' },
  });
  assert.equal(calls(), 2);
  assert.deepEqual(await fs.readFile(path.join(directory, 'a.result')), Buffer.from(PNG, 'base64'));
});

test('a timeout, a 502 or a dropped connection is interrupted and never sent again', async () => {
  const hang: ImageExecutorOptions['fetchImpl'] = (_url, init) =>
    new Promise((_resolve, reject) =>
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason)),
    );
  const cases = [
    [hang, 'TIMEOUT'],
    [async () => json(502, { error: { message: 'bad gateway' } }), 'UPSTREAM_ERROR'],
    [() => Promise.reject(new TypeError('fetch failed')), 'NETWORK_ERROR'],
  ] as const;
  for (const [reply, code] of cases) {
    const { outcome, calls } = await run([reply], 20);
    assert.equal(outcome.status, 'interrupted', code);
    assert.equal((outcome as any).error.code, code);
    assert.equal(calls(), 1, code);
  }
});

test('a moderation refusal fails at once and keeps the provider code', async () => {
  const code = 'OutputImageSensitiveContentDetected';
  const { outcome, calls } = await run([
    async () => json(400, { error: { code, message: 'The request failed' } }),
  ]);
  assert.equal(outcome.status, 'failed');
  assert.equal((outcome as any).error.code, 'CONTENT_REJECTED');
  assert.equal((outcome as any).error.upstreamCode, code);
  assert.equal(calls(), 1);
});
