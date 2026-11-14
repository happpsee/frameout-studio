// Runs generation tasks without the page: queues them, starts as many as each provider
// allows, saves every state change before acting on it, and tells subscribers.
//
// Rules that keep a user from being charged twice (docs/architecture/task-engine.md §5):
// - A task is saved as `running` before the provider is called, so a crash is never mistaken for "not sent".
// - After a restart, a `running` task becomes `interrupted`. Nothing is ever resubmitted automatically.
// - Only a queued task can be cancelled.
import { queue, type ProviderId } from '@frameout/shared';
import {
  canMove,
  EngineError,
  isFinished,
  TASK_ID,
  type Execute,
  type NewTask,
  type Outcome,
  type Task,
  type TaskStatus,
  type TaskStore,
  type TaskView,
} from './task.ts';

export type EngineEvent = { type: 'task'; task: TaskView } | { type: 'removed'; id: string };

export interface EngineOptions {
  store: TaskStore;
  execute: Execute;
  /** Tasks run at once per `provider:kind`, e.g. `{ 'ark:image': 3 }`. */
  limits?: Readonly<Record<string, number>>;
  defaultLimit?: number;
  /** Tasks allowed to wait; adding more is refused. */
  maxQueued?: number;
  now?: () => number;
  /** Told about storage and executor errors, which are never thrown at a caller. */
  onError?: (error: unknown) => void;
}

const groupOf = (task: Pick<Task, 'provider' | 'kind'>) => `${task.provider}:${task.kind}`;
const keyId = (provider: ProviderId, baseUrl: string) =>
  `${provider}\n${baseUrl.replace(/\/+$/, '')}`;
const validLimit = (value: number) => Number.isInteger(value) && value >= 1;

export class Engine {
  /** Insertion order is queue order. */
  readonly #tasks = new Map<string, Task>();
  /** API keys by provider and base URL. In memory only: never written to a task or to disk. */
  readonly #keys = new Map<string, string>();
  readonly #listeners = new Set<(event: EngineEvent) => void>();
  readonly #store: TaskStore;
  readonly #execute: Execute;
  readonly #limits: Readonly<Record<string, number>>;
  readonly #defaultLimit: number;
  readonly #maxQueued: number;
  readonly #now: () => number;
  readonly #report: (error: unknown) => void;

  constructor(options: EngineOptions) {
    this.#store = options.store;
    this.#execute = options.execute;
    this.#limits = options.limits ?? {};
    this.#defaultLimit = options.defaultLimit ?? 2;
    this.#maxQueued = options.maxQueued ?? 200;
    this.#now = options.now ?? Date.now;
    this.#report = options.onError ?? (() => {});
    // A limit of 0 would leave tasks queued forever with no explanation.
    if (![this.#defaultLimit, ...Object.values(this.#limits)].every(validLimit))
      throw new EngineError('INVALID_LIMIT', '并发上限必须是不小于 1 的整数');
  }

  /** Loads saved tasks. Call once, before anything else. */
  async start(): Promise<{ interrupted: number; skipped: number }> {
    const { tasks, skipped } = await this.#store.load();
    tasks.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    let interrupted = 0;
    for (const task of tasks) {
      this.#tasks.set(task.id, task);
      if (task.status !== 'running') continue;
      // The app stopped mid-request. The provider may have finished and charged; never run it again.
      interrupted++;
      await this.#finish(task.id, {
        status: 'interrupted',
        error: {
          code: 'RESTART_INTERRUPTED',
          message: '应用在生成过程中退出，供应商可能已经完成并计费',
        },
      });
    }
    this.#pump();
    return { interrupted, skipped };
  }

  list(): TaskView[] {
    return [...this.#tasks.values()].map(task => this.#view(task));
  }

  /** Returns a function that stops the subscription. */
  subscribe(listener: (event: EngineEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Gives the engine a key to use, or takes it away with `null`. */
  setKey(provider: ProviderId, baseUrl: string, key: string | null): void {
    const id = keyId(provider, baseUrl);
    if ((this.#keys.get(id) ?? null) === key) return;
    if (key) this.#keys.set(id, key);
    else this.#keys.delete(id);
    // Tasks waiting on this key change what they report.
    for (const task of this.#tasks.values())
      if (task.status === 'queued' && keyId(task.provider, task.baseUrl) === id) this.#emit(task);
    this.#pump();
  }

  /** Adds a task. Adding the same id again returns the existing task, so the call is safe to repeat. */
  async add(input: NewTask, key?: string): Promise<TaskView> {
    if (!TASK_ID.test(input.id)) throw new EngineError('INVALID_TASK', '任务 ID 无效');
    if (key) this.setKey(input.provider, input.baseUrl, key);
    const existing = this.#tasks.get(input.id);
    if (existing) return this.#view(existing);
    const queued = [...this.#tasks.values()].filter(task => task.status === 'queued').length;
    if (queued >= this.#maxQueued)
      throw new EngineError('QUEUE_FULL', '排队的任务太多，请等现有任务完成后再添加');
    // Only the known fields: the input may carry anything a caller sent.
    const { id, kind, provider, baseUrl, model, request, context } = input;
    const task: Task = {
      id,
      kind,
      provider,
      baseUrl,
      model,
      request,
      context,
      status: 'queued',
      attempts: 0,
      createdAt: this.#now(),
    };
    this.#tasks.set(task.id, task);
    this.#emit(task);
    try {
      await this.#persist(task);
    } catch (error) {
      this.#report(error);
      // Not saved, so it must not run: it would be lost on a restart.
      if (this.#tasks.get(task.id)?.status === 'queued') {
        this.#tasks.delete(task.id);
        this.#emitRemoved(task.id);
      }
      throw new EngineError('STORE_WRITE_FAILED', '任务无法保存，请检查磁盘空间后重试');
    }
    this.#pump();
    return this.#view(this.#tasks.get(task.id) ?? task);
  }

  /** Cancels a queued task. A running task cannot be cancelled: its request is already paid for. */
  async cancel(id: string): Promise<TaskView> {
    const task = this.#require(id);
    if (task.status !== 'queued')
      throw new EngineError('NOT_CANCELLABLE', '只有排队中的任务可以取消');
    const next = this.#apply(id, 'cancelled', { finishedAt: this.#now() });
    await this.#persist(next).catch(this.#report);
    return this.#view(next);
  }

  /** The caller has what it needs from a finished task; forget it. */
  async acknowledge(id: string): Promise<void> {
    const task = this.#require(id);
    if (!isFinished(task.status)) throw new EngineError('NOT_FINISHED', '任务还没有结束');
    this.#tasks.delete(id);
    this.#emitRemoved(id);
    await queue(`task:${id}`, () => this.#store.remove(id)).catch(this.#report);
  }

  /** Starts queued tasks, oldest first, while their group is under its limit and has a key. */
  #pump(): void {
    const running = new Map<string, number>();
    for (const task of this.#tasks.values())
      if (task.status === 'running')
        running.set(groupOf(task), (running.get(groupOf(task)) ?? 0) + 1);
    for (const task of [...this.#tasks.values()]) {
      if (task.status !== 'queued') continue;
      const key = this.#keys.get(keyId(task.provider, task.baseUrl));
      const group = groupOf(task);
      const count = running.get(group) ?? 0;
      if (!key || count >= (this.#limits[group] ?? this.#defaultLimit)) continue;
      running.set(group, count + 1);
      void this.#run(task.id, key).catch(this.#report);
    }
  }

  async #run(id: string, key: string): Promise<void> {
    // In memory first, so the next pump counts it; on disk before the provider is called.
    const task = this.#apply(id, 'running', { startedAt: this.#now() });
    try {
      await this.#persist(task);
    } catch (error) {
      this.#report(error);
      await this.#finish(id, {
        status: 'failed',
        error: { code: 'STORE_WRITE_FAILED', message: '任务状态无法保存，没有向供应商发送请求' },
      });
      return;
    }
    let outcome: Outcome;
    try {
      outcome = await this.#execute(task, { key, attempt: () => this.#attempt(id) });
    } catch (error) {
      this.#report(error);
      outcome = {
        status: 'interrupted',
        error: { code: 'EXECUTOR_ERROR', message: '执行中断，供应商可能已经处理了这次请求' },
      };
    }
    await this.#finish(id, outcome);
  }

  async #attempt(id: string): Promise<void> {
    const task = this.#require(id);
    const next = { ...task, attempts: task.attempts + 1 };
    this.#tasks.set(id, next);
    this.#emit(next);
    await this.#persist(next);
  }

  async #finish(id: string, outcome: Outcome): Promise<void> {
    const patch =
      outcome.status === 'succeeded' ? { result: outcome.result } : { error: outcome.error };
    const next = this.#apply(id, outcome.status, { ...patch, finishedAt: this.#now() });
    await this.#persist(next).catch(this.#report);
    this.#pump();
  }

  /** Moves a task to a new status in memory and tells subscribers. The only place a status changes. */
  #apply(id: string, status: TaskStatus, patch: Partial<Task>): Task {
    const task = this.#require(id);
    if (!canMove(task.status, status))
      throw new EngineError('INVALID_TRANSITION', `任务不能从 ${task.status} 变为 ${status}`);
    const next: Task = { ...task, ...patch, status };
    // A finished task no longer needs its prompt and reference images.
    if (isFinished(status)) delete next.request;
    this.#tasks.set(id, next);
    this.#emit(next);
    return next;
  }

  /** Writes for one task go to disk in the order they were made. */
  #persist(task: Task): Promise<void> {
    return queue(`task:${task.id}`, () => this.#store.put(task));
  }

  #require(id: string): Task {
    const task = this.#tasks.get(id);
    if (!task) throw new EngineError('NOT_FOUND', '找不到这个任务');
    return task;
  }

  #view(task: Task): TaskView {
    const needsKey =
      task.status === 'queued' && !this.#keys.has(keyId(task.provider, task.baseUrl));
    return { ...task, needsKey };
  }

  #emit(task: Task): void {
    this.#send({ type: 'task', task: this.#view(task) });
  }

  #emitRemoved(id: string): void {
    this.#send({ type: 'removed', id });
  }

  #send(event: EngineEvent): void {
    for (const listener of this.#listeners) {
      // A subscriber that throws must not stop a task from moving on.
      try {
        listener(event);
      } catch (error) {
        this.#report(error);
      }
    }
  }
}
