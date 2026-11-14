import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { createFileStore } from './file-store.ts';
import type { Task } from './task.ts';

const directory = () => fs.mkdtemp(path.join(os.tmpdir(), 'frameout-tasks-'));
const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id,
  kind: 'image',
  provider: 'ark',
  baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  model: 'model',
  status: 'queued',
  attempts: 0,
  createdAt: 1,
  ...extra,
});

test('saves, replaces, reads back and removes tasks', async () => {
  const root = path.join(await directory(), 'tasks');
  const store = createFileStore(root);
  assert.deepEqual(await store.load(), { tasks: [], skipped: 0 });

  await store.put(task('a', { request: { prompt: '猫' } }));
  await store.put(task('b'));
  await store.put(task('a', { status: 'running', startedAt: 2 }));
  const { tasks } = await createFileStore(root).load();
  assert.deepEqual(
    tasks.sort((x, y) => x.id.localeCompare(y.id)),
    [task('a', { status: 'running', startedAt: 2 }), task('b')],
  );

  await store.remove('a');
  await store.remove('a');
  assert.deepEqual((await store.load()).tasks, [task('b')]);
  assert.deepEqual(await fs.readdir(root), ['b.json']);
});

test('skips records it cannot trust and clears interrupted writes', async () => {
  const root = await directory();
  const store = createFileStore(root);
  await store.put(task('good'));
  await fs.writeFile(path.join(root, 'broken.json'), '{"id":');
  await fs.writeFile(path.join(root, 'wrong.json'), JSON.stringify(task('other')));
  await fs.writeFile(path.join(root, 'bad.json'), JSON.stringify({ ...task('bad'), status: 'x' }));
  await fs.writeFile(path.join(root, '.half.tmp'), 'partial');
  await fs.writeFile(path.join(root, 'notes.txt'), 'not a task');

  const { tasks, skipped } = await store.load();
  assert.deepEqual(tasks, [task('good')]);
  assert.equal(skipped, 3);
  assert.equal((await fs.readdir(root)).includes('.half.tmp'), false);
  // Unreadable records are left in place for inspection.
  assert.equal((await fs.readdir(root)).includes('broken.json'), true);
});

test('never writes outside its directory', async () => {
  const store = createFileStore(await directory());
  await assert.rejects(store.put(task('../escape')), TypeError);
  await assert.rejects(store.remove('a/b'), TypeError);
});
