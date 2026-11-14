import assert from 'node:assert/strict';
import { test } from 'vitest';
import { Engine, type EngineEvent, type EngineOptions } from './engine.ts';
import {
  EngineError,
  type Execution,
  type NewTask,
  type Outcome,
  type Task,
  type TaskStore,
} from './task.ts';

const ARK = 'https://ark.cn-beijing.volces.com/api/v3';
const OPENAI = 'https://api.openai.com/v1';
const KEY = 'test-only-key';

const tick = () => new Promise(resolve => setImmediate(resolve));
const task = (id: string, provider: 'ark' | 'openai' = 'ark'): NewTask => ({
  id,
  kind: 'image',
  provider,
  baseUrl: provider === 'ark' ? ARK : OPENAI,
  model: 'model',
  request: { prompt: id },
  context: { card: id },
});

function memoryStore(initial: Task[] = []) {
  const saved = new Map(initial.map(item => [item.id, structuredClone(item)]));
  const failing = { put: false };
  const store: TaskStore = {
    async load() {
      return { tasks: [...saved.values()].map(item => structuredClone(item)), skipped: 0 };
    },
    async put(item) {
      if (failing.put) throw new Error('disk full');
      saved.set(item.id, structuredClone(item));
    },
    async remove(id) {
      saved.delete(id);
    },
  };
  return { store, saved, failing };
}

/** An executor the test finishes by hand. */
function setup(options: Partial<EngineOptions> = {}, initial: Task[] = []) {
  const { store, saved, failing } = memoryStore(initial);
  const calls: { task: Task; execution: Execution; finish: (outcome: Outcome) => void }[] = [];
  const errors: unknown[] = [];
  const engine = new Engine({
    store,
    execute: (item, execution) =>
      new Promise(finish => {
        calls.push({ task: item, execution, finish });
      }),
    onError: error => errors.push(error),
    ...options,
  });
  const events: EngineEvent[] = [];
  engine.subscribe(event => events.push(event));
  const status = (id: string) => engine.list().find(item => item.id === id)?.status;
  const started = () => calls.map(call => call.task.id);
  return { engine, saved, failing, calls, errors, events, status, started };
}

const code = (expected: string) => (error: unknown) =>
  error instanceof EngineError && error.code === expected;

test('runs up to the limit, oldest first, and starts the next when one finishes', async () => {
  const { engine, calls, status, started } = setup({ defaultLimit: 2 });
  for (const id of ['a', 'b', 'c', 'd']) await engine.add(task(id), KEY);
  await tick();
  assert.deepEqual(started(), ['a', 'b']);
  assert.equal(status('c'), 'queued');

  calls[1].finish({ status: 'succeeded', result: { file: 'b.png' } });
  await tick();
  assert.deepEqual(started(), ['a', 'b', 'c']);
  assert.equal(status('b'), 'succeeded');
  assert.equal(status('d'), 'queued');
});

test('each provider and kind has its own limit', async () => {
  const { engine, started } = setup({ defaultLimit: 1, limits: { 'openai:image': 2 } });
  engine.setKey('ark', ARK, KEY);
  engine.setKey('openai', OPENAI, KEY);
  for (const id of ['a1', 'a2']) await engine.add(task(id, 'ark'));
  for (const id of ['o1', 'o2', 'o3']) await engine.add(task(id, 'openai'));
  await tick();
  assert.deepEqual(started().sort(), ['a1', 'o1', 'o2']);
});

test('a limit below 1 is refused when the engine is created', () => {
  assert.throws(() => setup({ defaultLimit: 0 }), code('INVALID_LIMIT'));
  assert.throws(() => setup({ limits: { 'ark:image': 0 } }), code('INVALID_LIMIT'));
});

test('adding the same id twice keeps one task and runs it once', async () => {
  const { engine, calls } = setup();
  const first = await engine.add(task('a'), KEY);
  const second = await engine.add({ ...task('a'), model: 'another' }, KEY);
  await tick();
  assert.equal(second.model, first.model);
  assert.equal(engine.list().length, 1);
  assert.equal(calls.length, 1);
});

test('refuses an id that could not be a file name, and a full queue', async () => {
  const { engine } = setup({ maxQueued: 2 });
  await assert.rejects(engine.add(task('../etc')), code('INVALID_TASK'));
  await engine.add(task('a'));
  await engine.add(task('b'));
  await assert.rejects(engine.add(task('c')), code('QUEUE_FULL'));
});

test('a task is saved as running before the provider is called', async () => {
  const seen: (string | undefined)[] = [];
  const { store, saved } = memoryStore();
  const engine = new Engine({
    store,
    execute: async item => {
      seen.push(saved.get(item.id)?.status);
      return { status: 'succeeded' };
    },
  });
  await engine.add(task('a'), KEY);
  await tick();
  assert.deepEqual(seen, ['running']);
});

test('outcomes become statuses; a finished task drops its request', async () => {
  const { engine, calls, saved, status, errors } = setup({ defaultLimit: 4 });
  for (const id of ['ok', 'no', 'unknown']) await engine.add(task(id), KEY);
  await tick();
  calls[0].finish({ status: 'succeeded', result: { file: 'ok.png' } });
  calls[1].finish({ status: 'failed', error: { code: 'CONTENT_REJECTED', message: '被拒绝' } });
  calls[2].finish({ status: 'interrupted', error: { code: 'TIMEOUT', message: '超时' } });
  await tick();
  assert.deepEqual(
    [status('ok'), status('no'), status('unknown')],
    ['succeeded', 'failed', 'interrupted'],
  );
  assert.deepEqual(saved.get('ok')?.result, { file: 'ok.png' });
  assert.equal(saved.get('no')?.error?.code, 'CONTENT_REJECTED');
  for (const id of ['ok', 'no', 'unknown']) {
    assert.equal(saved.get(id)?.request, undefined);
    assert.deepEqual(saved.get(id)?.context, { card: id });
  }
  assert.deepEqual(errors, []);
});

test('an executor that throws leaves the outcome unknown, not failed', async () => {
  const { store, saved } = memoryStore();
  const errors: unknown[] = [];
  const engine = new Engine({
    store,
    execute: async () => {
      throw new Error('boom');
    },
    onError: error => errors.push(error),
  });
  await engine.add(task('a'), KEY);
  await tick();
  assert.equal(saved.get('a')?.status, 'interrupted');
  assert.equal(saved.get('a')?.error?.code, 'EXECUTOR_ERROR');
  assert.equal(errors.length, 1);
});

test('attempts are saved before each request leaves', async () => {
  const { engine, calls, saved } = setup();
  await engine.add(task('a'), KEY);
  await tick();
  await calls[0].execution.attempt();
  assert.equal(saved.get('a')?.attempts, 1);
  await calls[0].execution.attempt();
  assert.equal(saved.get('a')?.attempts, 2);
  assert.equal(calls[0].execution.key, KEY);
});

test('only a queued task can be cancelled, and it never runs', async () => {
  const { engine, calls, saved, started } = setup({ defaultLimit: 1 });
  await engine.add(task('a'), KEY);
  await engine.add(task('b'), KEY);
  await tick();
  await assert.rejects(engine.cancel('a'), code('NOT_CANCELLABLE'));
  assert.equal((await engine.cancel('b')).status, 'cancelled');
  assert.equal(saved.get('b')?.status, 'cancelled');
  await assert.rejects(engine.cancel('missing'), code('NOT_FOUND'));

  calls[0].finish({ status: 'succeeded' });
  await tick();
  assert.deepEqual(started(), ['a']);
});

test('without a key a task waits, and starts when the key arrives', async () => {
  const { engine, started } = setup();
  const added = await engine.add(task('a'));
  await tick();
  assert.equal(added.needsKey, true);
  assert.deepEqual(started(), []);

  engine.setKey('ark', `${ARK}/`, KEY);
  await tick();
  assert.deepEqual(started(), ['a']);
  assert.equal(engine.list()[0].needsKey, false);
});

test('taking a key away stops new tasks from starting', async () => {
  const { engine, started } = setup();
  engine.setKey('ark', ARK, KEY);
  engine.setKey('ark', ARK, null);
  await engine.add(task('a'));
  await tick();
  assert.deepEqual(started(), []);
});

test('after a restart, running tasks are interrupted and never run again', async () => {
  const before: Task[] = [
    { ...task('ran'), status: 'running', attempts: 1, createdAt: 1, startedAt: 2 },
    { ...task('waiting'), status: 'queued', attempts: 0, createdAt: 3 },
    { ...task('done'), status: 'succeeded', attempts: 1, createdAt: 0, finishedAt: 5 },
  ];
  const { engine, saved, started, status } = setup({}, before);
  assert.deepEqual(await engine.start(), { interrupted: 1, skipped: 0 });
  assert.equal(saved.get('ran')?.status, 'interrupted');
  assert.equal(saved.get('ran')?.error?.code, 'RESTART_INTERRUPTED');
  assert.equal(saved.get('ran')?.request, undefined);
  assert.deepEqual(
    engine.list().map(item => item.id),
    ['done', 'ran', 'waiting'],
  );

  // No key survives a restart; the queued task waits for the page to hand one over.
  await tick();
  assert.deepEqual(started(), []);
  engine.setKey('ark', ARK, KEY);
  await tick();
  assert.deepEqual(started(), ['waiting']);
  assert.equal(status('ran'), 'interrupted');
});

test('a task that cannot be saved is refused and never runs', async () => {
  const { engine, failing, started, errors } = setup();
  failing.put = true;
  await assert.rejects(engine.add(task('a'), KEY), code('STORE_WRITE_FAILED'));
  await tick();
  assert.deepEqual(engine.list(), []);
  assert.deepEqual(started(), []);
  assert.equal(errors.length, 1);
});

test('if the running state cannot be saved, the provider is not called', async () => {
  const { engine, failing, started, status } = setup();
  await engine.add(task('a'));
  failing.put = true;
  engine.setKey('ark', ARK, KEY);
  await tick();
  assert.deepEqual(started(), []);
  assert.equal(status('a'), 'failed');
  assert.equal(engine.list()[0].error?.code, 'STORE_WRITE_FAILED');
});

test('subscribers hear every change; acknowledging forgets a finished task', async () => {
  const { engine, calls, saved, events } = setup();
  await engine.add(task('a'), KEY);
  await tick();
  await assert.rejects(engine.acknowledge('a'), code('NOT_FINISHED'));
  calls[0].finish({ status: 'succeeded' });
  await tick();
  await engine.acknowledge('a');

  const seen = events.map(event => (event.type === 'task' ? event.task.status : 'removed'));
  assert.deepEqual(seen, ['queued', 'running', 'succeeded', 'removed']);
  assert.deepEqual(engine.list(), []);
  assert.equal(saved.has('a'), false);
});

test('a subscriber that throws does not stop the task', async () => {
  const { engine, calls, status, errors } = setup();
  engine.subscribe(() => {
    throw new Error('listener');
  });
  await engine.add(task('a'), KEY);
  await tick();
  calls[0].finish({ status: 'succeeded' });
  await tick();
  assert.equal(status('a'), 'succeeded');
  assert.ok(errors.length > 0);
});
