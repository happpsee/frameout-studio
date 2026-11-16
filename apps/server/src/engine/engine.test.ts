import assert from 'node:assert/strict';
import { test } from 'vitest';
import { Engine } from './engine.ts';
import { EngineError, type NewTask, type Outcome, type Task, type TaskStore } from './task.ts';

const ARK = 'https://ark.cn-beijing.volces.com/api/v3';
const KEY = 'test-only-key';

const tick = () => new Promise(resolve => setImmediate(resolve));
const task = (id: string): NewTask => ({
  id,
  kind: 'image',
  provider: 'ark',
  baseUrl: ARK,
  model: 'model',
  request: { prompt: id },
});

/** An engine over an in-memory store, with an executor the test finishes by hand. */
function setup(initial: Task[] = []) {
  const saved = new Map(initial.map(item => [item.id, item]));
  const store: TaskStore = {
    load: async () => ({ tasks: [...saved.values()], skipped: 0 }),
    put: async item => void saved.set(item.id, structuredClone(item)),
    remove: async id => void saved.delete(id),
  };
  const calls: {
    id: string;
    saved?: string;
    job?: string;
    finish: (outcome: Outcome) => void;
  }[] = [];
  const engine = new Engine({
    store,
    execute: item =>
      new Promise(finish => {
        calls.push({
          id: item.id,
          saved: saved.get(item.id)?.status,
          job: item.providerJobId,
          finish,
        });
      }),
  });
  const started = () => calls.map(call => call.id);
  return { engine, saved, calls, started };
}

test('runs two at a time, oldest first, and starts the next when one finishes', async () => {
  const { engine, calls, started } = setup();
  for (const id of ['a', 'b', 'c']) await engine.add(task(id), KEY);
  await tick();
  assert.deepEqual(started(), ['a', 'b']);

  calls[0].finish({ status: 'succeeded' });
  await tick();
  assert.deepEqual(started(), ['a', 'b', 'c']);
});

test('a task is saved as running before the provider is called', async () => {
  const { engine, calls } = setup();
  await engine.add(task('a'), KEY);
  await tick();
  assert.equal(calls[0].saved, 'running');
});

test('after a restart, a running task is interrupted and never runs again', async () => {
  const { engine, saved, started } = setup([
    { ...task('ran'), status: 'running', createdAt: 1 },
    { ...task('waiting'), status: 'queued', createdAt: 2 },
  ]);
  await engine.start();
  engine.setKey('ark', ARK, KEY);
  await tick();
  assert.equal(saved.get('ran')?.status, 'interrupted');
  assert.deepEqual(started(), ['waiting']);
});

test('after a restart, a task with a saved provider job waits for its key, then polls that job', async () => {
  const { engine, calls } = setup([
    { ...task('video'), kind: 'video', status: 'running', providerJobId: 'job-1', createdAt: 1 },
  ]);
  await engine.start();
  await tick();
  assert.equal(calls.length, 0);
  assert.equal(engine.list()[0].needsKey, true);

  engine.setKey('ark', ARK, KEY);
  await tick();
  assert.deepEqual(
    calls.map(call => [call.id, call.job, call.saved]),
    [['video', 'job-1', 'running']],
  );
});

test('only a queued task can be cancelled, and it never runs', async () => {
  const { engine, calls, started } = setup();
  for (const id of ['a', 'b', 'c']) await engine.add(task(id), KEY);
  await tick();
  await assert.rejects(engine.cancel('a'), EngineError);
  assert.equal((await engine.cancel('c')).status, 'cancelled');

  calls[0].finish({ status: 'succeeded' });
  await tick();
  assert.deepEqual(started(), ['a', 'b']);
});

test('adding the same id twice runs it once', async () => {
  const { engine, started } = setup();
  await engine.add(task('a'), KEY);
  await engine.add(task('a'), KEY);
  await tick();
  assert.deepEqual(started(), ['a']);
});

test('without a key a task waits, and starts when the key arrives', async () => {
  const { engine, started } = setup();
  assert.equal((await engine.add(task('a'))).needsKey, true);
  await tick();
  assert.deepEqual(started(), []);

  engine.setKey('ark', ARK, KEY);
  await tick();
  assert.deepEqual(started(), ['a']);
});
