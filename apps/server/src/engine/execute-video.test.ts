import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { createVideoExecutor } from './execute-video.ts';
import type { Task } from './task.ts';

const ARK = 'https://ark.cn-beijing.volces.com/api/v3';
const VIDEO_URL = 'https://media.provider.example/video.mp4';
const task: Task = {
  id: 'v',
  kind: 'video',
  provider: 'ark',
  baseUrl: ARK,
  model: 'model',
  request: { prompt: 'rain', ratio: '16:9', duration: 5, resolution: '720p' },
  status: 'running',
  createdAt: 1,
};
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });

/** A fake Ark: the job runs once, then succeeds. Records each call as "METHOD path". */
async function run(input: Task) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'frameout-video-'));
  const calls: string[] = [];
  const events: string[] = [];
  let checks = 0;
  const execute = createVideoExecutor({
    directory,
    timeoutMs: 1000,
    pollMs: [0, 0],
    fetchImpl: async (url, init) => {
      const { pathname } = new URL(url);
      calls.push(`${init.method ?? 'GET'} ${pathname}`);
      if (url === VIDEO_URL)
        return new Response(new Uint8Array([0, 0, 0, 24]), {
          headers: { 'content-type': 'video/mp4' },
        });
      if (init.method === 'POST') return json({ id: 'job-1', status: 'queued' });
      events.push('poll');
      return json(
        checks++ === 0
          ? { id: 'job-1', status: 'running' }
          : { id: 'job-1', status: 'succeeded', content: { video_url: VIDEO_URL } },
      );
    },
  });
  const outcome = await execute(input, {
    key: 'test-only-key',
    update: async patch => {
      if (patch.providerJobId) events.push(`saved ${patch.providerJobId}`);
    },
  });
  return { outcome, calls, events, directory };
}

test('a new video is submitted once, its job id saved before polling, then the file saved', async () => {
  const { outcome, calls, events, directory } = await run(task);
  assert.equal(outcome.status, 'succeeded');
  assert.equal(calls.filter(call => call.startsWith('POST')).length, 1);
  assert.deepEqual(events, ['saved job-1', 'poll', 'poll']);
  assert.equal((await fs.readFile(path.join(directory, 'v.result'))).length, 4);
});

test('after a restart, a task with a job id is only polled, never submitted again', async () => {
  const { outcome, calls } = await run({ ...task, providerJobId: 'job-1', request: undefined });
  assert.equal(outcome.status, 'succeeded');
  assert.equal(calls.filter(call => call.startsWith('POST')).length, 0);
});
