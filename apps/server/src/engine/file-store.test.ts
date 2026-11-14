import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { createFileStore } from './file-store.ts';
import type { Task } from './task.ts';

const task = (id: string, status: Task['status'] = 'queued'): Task => ({
  id,
  kind: 'image',
  provider: 'ark',
  baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  model: 'model',
  status,
  createdAt: 1,
});

test('saves and reads back tasks, skipping a file it cannot read', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'frameout-tasks-'));
  const store = createFileStore(root);
  await store.put(task('a'));
  await store.put(task('a', 'running'));
  await store.put(task('b'));
  await store.remove('b');
  await fs.writeFile(path.join(root, 'broken.json'), '{"id":');

  assert.deepEqual(await createFileStore(root).load(), {
    tasks: [task('a', 'running')],
    skipped: 1,
  });
});
