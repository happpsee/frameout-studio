// Runs generation tasks without the page: queues them, runs a few at a time per provider,
// saves every state change, and tells subscribers.
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
  /** Tasks run at once for each provider and kind. */
  limit?: number;
  now?: () => number;
}

const groupOf = (task: Task) => `${task.provider}:${task.kind}`;
const keyId = (provider: ProviderId, baseUrl: string) =>
  `${provider}\n${baseUrl.replace(/\/+$/, '')}`;

export class Engine {
  /** Insertion order is queue order. */
  readonly #tasks = new Map<string, Task>();
  /** API keys by provider and base URL. In memory only: never written to a task or to disk. */
  readonly #keys = new Map<string, string>();
  readonly #listeners = new Set<(event: EngineEvent) => void>();
  readonly #store: TaskStore;
  readonly #execute: Execute;
  readonly #limit: number;
  readonly #now: () => number;

  constructor(options: EngineOptions) {
    this.#store = options.store;
    this.#execute = options.execute;
    this.#limit = options.limit ?? 2;
    this.#now = options.now ?? Date.now;
  }

  /** Loads saved tasks. Call once, before anything else. */
  async start(): Promise<void> {
    const { tasks } = await this.#store.load();
    tasks.sort((a, b) => a.createdAt - b.createdAt);
    for (const task of tasks) {
      this.#tasks.set(task.id, task);
      // The app stopped mid-request. The provider may have finished and charged; never run it again.
      if (task.status === 'running')
        await this.#finish(task.id, {
          status: 'interrupted',
          error: {
            code: 'RESTART_INTERRUPTED',
            message: '应用在生成过程中退出，供应商可能已经完成并计费',
          },
        });
    }
    this.#pump();
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
    if (key) this.#keys.set(keyId(provider, baseUrl), key);
    else this.#keys.delete(keyId(provider, baseUrl));
    this.#pump();
  }

  /** Adds a task. Adding the same id again returns the existing task, so the call is safe to repeat. */
  async add(input: NewTask, key?: string): Promise<TaskView> {
    // The id is also the file name.
    if (!TASK_ID.test(input.id)) throw new EngineError('INVALID_TASK', '任务 ID 无效');
    if (key) this.setKey(input.provider, input.baseUrl, key);
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
      createdAt: this.#now(),
    };
    // Saved before it can run, so a task is never lost on a restart.
    if (!this.#tasks.has(id)) await this.#persist(task);
    const existing = this.#tasks.get(id);
    if (existing) return this.#view(existing);
    this.#tasks.set(id, task);
    this.#emit(task);
    this.#pump();
    return this.#view(this.#require(id));
  }

  /** Cancels a queued task. A running task cannot be cancelled: its request is already paid for. */
  async cancel(id: string): Promise<TaskView> {
    if (this.#require(id).status !== 'queued')
      throw new EngineError('NOT_CANCELLABLE', '只有排队中的任务可以取消');
    const next = this.#apply(id, 'cancelled', { finishedAt: this.#now() });
    await this.#persist(next);
    return this.#view(next);
  }

  /** The caller has what it needs from a finished task; forget it. */
  async acknowledge(id: string): Promise<void> {
    if (!isFinished(this.#require(id).status))
      throw new EngineError('NOT_FINISHED', '任务还没有结束');
    this.#tasks.delete(id);
    for (const listener of this.#listeners) listener({ type: 'removed', id });
    await queue(`task:${id}`, () => this.#store.remove(id));
  }

  /** Starts queued tasks, oldest first, while their group is under the limit and has a key. */
  #pump(): void {
    const running = new Map<string, number>();
    for (const task of this.#tasks.values())
      if (task.status === 'running')
        running.set(groupOf(task), (running.get(groupOf(task)) ?? 0) + 1);
    for (const task of [...this.#tasks.values()]) {
      const key = this.#keys.get(keyId(task.provider, task.baseUrl));
      const count = running.get(groupOf(task)) ?? 0;
      if (task.status !== 'queued' || !key || count >= this.#limit) continue;
      running.set(groupOf(task), count + 1);
      void this.#run(task.id, key);
    }
  }

  async #run(id: string, key: string): Promise<void> {
    // In memory first, so the next pump counts it; on disk before the provider is called.
    const task = this.#apply(id, 'running', { startedAt: this.#now() });
    let outcome: Outcome;
    try {
      await this.#persist(task);
      outcome = await this.#execute(task, { key });
    } catch {
      // Not `failed`: the request may have reached the provider, and a retry could charge twice.
      outcome = {
        status: 'interrupted',
        error: { code: 'EXECUTOR_ERROR', message: '执行中断，供应商可能已经处理了这次请求' },
      };
    }
    await this.#finish(id, outcome);
  }

  async #finish(id: string, outcome: Outcome): Promise<void> {
    const patch =
      outcome.status === 'succeeded' ? { result: outcome.result } : { error: outcome.error };
    const next = this.#apply(id, outcome.status, { ...patch, finishedAt: this.#now() });
    // If this write fails the file still says `running`, which a restart turns into `interrupted`.
    await this.#persist(next).catch(() => {});
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
    for (const listener of this.#listeners) listener({ type: 'task', task: this.#view(task) });
  }
}
