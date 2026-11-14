// The task record, the states it may move between, and the contracts the engine depends on.
// Design: docs/architecture/task-engine.md
import { isProviderId, type ProviderId } from '@frameout/shared';

export const TASK_STATUSES = [
  'queued',
  'running',
  'succeeded',
  // Definitely failed: refused, invalid, or retries used up.
  'failed',
  // Outcome unknown: the provider may have done the work and charged for it.
  'interrupted',
  'cancelled',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskKind = 'image';

/** A task id is also its file name, so it must never contain a path separator or a dot. */
export const TASK_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Only these moves are allowed; a running task can never go back to queued (no automatic resubmit). */
const NEXT: Record<TaskStatus, readonly TaskStatus[]> = {
  queued: ['running', 'cancelled'],
  running: ['succeeded', 'failed', 'interrupted'],
  succeeded: [],
  failed: [],
  interrupted: [],
  cancelled: [],
};
export const canMove = (from: TaskStatus, to: TaskStatus) => NEXT[from].includes(to);
export const isFinished = (status: TaskStatus) => NEXT[status].length === 0;

export interface TaskError {
  code: string;
  message: string;
  /** The provider's own error code, when it gave one. */
  upstreamCode?: string;
}

/** Never holds an API key: keys stay in the engine's memory. */
export interface Task {
  id: string;
  kind: TaskKind;
  provider: ProviderId;
  baseUrl: string;
  model: string;
  /** What to generate. Dropped once the task finishes. */
  request?: unknown;
  status: TaskStatus;
  error?: TaskError;
  /** Submit-then-poll providers (video): saved before polling starts. */
  providerJobId?: string;
  /** Where the executor put the result. */
  result?: unknown;
  /** The caller's own data (project, card position); stored and returned untouched. */
  context?: unknown;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
}

export type NewTask = Pick<Task, 'id' | 'kind' | 'provider' | 'baseUrl' | 'model'> &
  Pick<Partial<Task>, 'request' | 'context'>;

/** A task as callers see it. `needsKey`: queued, and the engine has no key for its provider. */
export type TaskView = Task & { needsKey: boolean };

export type Outcome =
  | { status: 'succeeded'; result?: unknown }
  | { status: 'failed' | 'interrupted'; error: TaskError };

export interface Execution {
  key: string;
}

/** Calls the provider. A thrown error is treated as an unknown outcome (`interrupted`). */
export type Execute = (task: Task, execution: Execution) => Promise<Outcome>;

export interface TaskStore {
  /** `skipped`: records that could not be read; they are left alone and do not stop the others. */
  load(): Promise<{ tasks: Task[]; skipped: number }>;
  put(task: Task): Promise<void>;
  remove(id: string): Promise<void>;
}

export class EngineError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const optional = (value: unknown, type: 'number' | 'string') =>
  value === undefined || typeof value === type;

/** Checks a record read from disk. Returns the task, or undefined when it is not a valid one. */
export function readTask(value: unknown): Task | undefined {
  if (!isObject(value)) return undefined;
  const valid =
    typeof value.id === 'string' &&
    TASK_ID.test(value.id) &&
    value.kind === 'image' &&
    isProviderId(value.provider) &&
    typeof value.baseUrl === 'string' &&
    typeof value.model === 'string' &&
    (TASK_STATUSES as readonly unknown[]).includes(value.status) &&
    typeof value.createdAt === 'number' &&
    optional(value.startedAt, 'number') &&
    optional(value.finishedAt, 'number') &&
    optional(value.providerJobId, 'string') &&
    (value.error === undefined ||
      (isObject(value.error) &&
        typeof value.error.code === 'string' &&
        typeof value.error.message === 'string'));
  return valid ? (value as unknown as Task) : undefined;
}
