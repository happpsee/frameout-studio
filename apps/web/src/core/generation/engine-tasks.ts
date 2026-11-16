// The desktop app's task engine, seen from the page: hand it a generation, hear back when it ends.
// The engine runs in the local server process, so a generation survives closing the window.
// Server side: apps/server/src/engine/. Design: docs/architecture/task-engine.md.
import type { ProviderId } from '@frameout/shared';

export type EngineTaskStatus =
  'queued' | 'running' | 'succeeded' | 'failed' | 'interrupted' | 'cancelled';

/** Where the result goes: the project, the placeholder card waiting for it, and its final label. */
export interface ImageTaskContext {
  projectId: string;
  cardId: string;
  label: string;
}

export interface EngineTask {
  id: string;
  kind: 'image' | 'video';
  status: EngineTaskStatus;
  /** Video: the provider's job, once submitted. */
  providerJobId?: string;
  progress?: number;
  error?: { code: string; message: string };
  context?: ImageTaskContext;
  needsKey: boolean;
}

export type EngineEvent =
  | { type: 'snapshot'; tasks: EngineTask[] }
  | { type: 'task'; task: EngineTask }
  | { type: 'removed'; id: string };

export const isEnded = (status: EngineTaskStatus) => status !== 'queued' && status !== 'running';

async function call(path: string, body?: unknown): Promise<Response> {
  const response = await fetch(`/api/tasks${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const reply = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(reply?.error?.message || '本机生成服务没有响应，请重启应用后再试');
  }
  return response;
}

export interface ImageTaskInput {
  id: string;
  provider: ProviderId;
  baseUrl: string;
  model: string;
  request: { prompt: string; references: string[]; size: string };
  context: ImageTaskContext;
  apiKey: string;
}

export const addImageTask = (input: ImageTaskInput) => call('', input).then(() => undefined);

export interface VideoTaskInput extends Omit<ImageTaskInput, 'request'> {
  request: {
    prompt: string;
    reference?: string;
    ratio: string;
    duration: number;
    resolution: string;
  };
}

export const addVideoTask = (input: VideoTaskInput) =>
  call('', { ...input, kind: 'video' }).then(() => undefined);

/** After a restart the engine has no keys; queued tasks wait until the page hands them back. */
export const giveKey = (provider: ProviderId, baseUrl: string, apiKey: string) =>
  call('/keys', { provider, baseUrl, apiKey }).then(() => undefined);

export const cancelTask = (id: string) => call(`/${id}/cancel`, {}).then(() => undefined);

export const taskResult = (id: string) => call(`/${id}/result`).then(response => response.blob());

/** The page has saved the result; the engine can forget the task and its file. */
export const acknowledgeTask = (id: string) => call(`/${id}/ack`, {}).then(() => undefined);

/** Follows the engine's events. The browser reconnects by itself; each connection starts with a snapshot. */
export function watchTasks(listener: (event: EngineEvent) => void): () => void {
  if (typeof EventSource === 'undefined') return () => {};
  const source = new EventSource('/api/tasks/events');
  source.onmessage = message => listener(JSON.parse(message.data) as EngineEvent);
  return () => source.close();
}
