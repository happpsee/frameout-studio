import { useEffect, useRef } from 'react';
import { PROVIDERS } from '@frameout/shared';
import type { AIConfig, Card, ProjectState, UpdateProject } from '../../types';
import { isDesktop } from '../../platform';
import { PENDING_MEDIA, placeholder, preferenceOnly, uid } from '../project/project';
import { putMedia } from '../project/media-store';
import { markImageFailed, placeImageCard } from './failed-image';
import {
  acknowledgeTask,
  addImageTask,
  addVideoTask,
  cancelTask,
  isEnded,
  taskResult,
  watchTasks,
  type EngineTask,
} from './engine-tasks';

/** The placeholder a desktop image generation leaves on the canvas until its result arrives. */
export const ENGINE_IMAGE_LABEL = '图片生成中';
const WAITING_MEDIA = placeholder('图片生成中');
export const engineImage = (card?: Card) => card?.label === ENGINE_IMAGE_LABEL;

export interface EngineImageRequest {
  /** What the user wrote; becomes the card's name and prompt. */
  text: string;
  /** What is sent: with the shared notes and reference roles. */
  prompt: string;
  references: string[];
  config: AIConfig;
  at: { x: number; y: number };
  label: string;
  replace?: string;
  onCard?: (id: string) => void;
}

export interface EngineVideoRequest {
  text: string;
  /** With the shared notes. */
  prompt: string;
  /** The first frame, as a data URL. */
  reference?: string;
  source?: Card;
  config: AIConfig;
  at: { x: number; y: number };
  onCard?: (id: string) => void;
}

/** How a generation ended, for the page that is still waiting on it. */
export type EngineOutcome = { ok: true } | { ok: false; message: string };

type Options = {
  projectId: string;
  update: UpdateProject;
};

const findCard = (draft: ProjectState, id?: string) => draft.cards.find(item => item.id === id);

/** The finished file on its card. Images drop their job; videos keep it, as page generations do. */
async function placeResult(task: EngineTask, update: UpdateProject) {
  const blob = await taskResult(task.id);
  const mediaId = await putMedia(blob);
  const src = URL.createObjectURL(blob);
  update(draft => {
    const card = findCard(draft, task.context?.cardId);
    if (!card) return;
    Object.assign(card, {
      src,
      mediaId,
      mimeType: blob.type,
      generatedAt: new Date().toISOString(),
    });
    card.label = task.context?.label ?? (task.kind === 'video' ? 'AI 生成视频' : 'AI 生成图片');
    if (task.kind !== 'video') {
      card.kind = 'image';
      delete card.job;
    } else if (card.job) {
      card.kind = 'video';
      card.duration = card.job.config.duration;
      card.job = { ...card.job, status: 'succeeded', engine: false, error: '' };
    }
  }, false);
}

/** Why it ended, on its card. A video the engine lost track of can still be queried by its job id. */
function placeFailure(task: EngineTask, message: string, update: UpdateProject) {
  const cardId = task.context?.cardId;
  update(draft => {
    const card = findCard(draft, cardId);
    if (!card?.job) return;
    if (task.kind !== 'video') markImageFailed(card, message, { ...card.job.config, key: '' });
    else if (task.status === 'interrupted' && task.providerJobId)
      card.job = {
        ...card.job,
        id: task.providerJobId,
        status: 'paused',
        engine: false,
        error: message,
      };
    else card.job = { ...card.job, status: 'failed', engine: false, error: message };
    for (const step of draft.workflow?.steps ?? [])
      if (step.outputCardId === cardId) {
        step.status = 'failed';
        step.error = message;
      }
  }, false);
}

function imagePlaceholder(request: EngineImageRequest, cardId: string, taskId: string): Card {
  const { config } = request;
  return {
    id: cardId,
    ...request.at,
    name: request.text.slice(0, 18),
    prompt: request.text,
    src: WAITING_MEDIA,
    kind: 'image',
    provider: config.provider,
    size: config.imageSize,
    label: ENGINE_IMAGE_LABEL,
    job: {
      id: taskId,
      provider: config.provider,
      status: 'queued',
      prompt: request.text,
      config: preferenceOnly(config),
    },
  };
}

function videoPlaceholder(request: EngineVideoRequest, cardId: string, taskId: string): Card {
  const { config } = request;
  return {
    id: cardId,
    ...request.at,
    name: request.text.slice(0, 18) + ' · 视频',
    prompt: request.text,
    sourceId: request.source?.id ?? '',
    src: request.source?.src || PENDING_MEDIA,
    kind: 'image',
    provider: config.provider,
    label: '视频任务',
    job: {
      id: taskId,
      provider: config.provider,
      status: 'queued',
      prompt: request.text,
      config: preferenceOnly(config),
      engine: true,
    },
  };
}

/**
 * Desktop only: generations go to the local task engine, so they finish even when the window
 * closes. A placeholder card waits on the canvas; when the task ends, the result (or the reason it
 * failed) takes its place, now or the next time this project opens.
 */
export function useEngineTasks({ projectId, update }: Options) {
  const enabled = isDesktop();
  const waiters = useRef(new Map<string, (outcome: EngineOutcome) => void>());
  const settling = useRef(new Set<string>());
  const latest = useRef({ update });
  latest.current = { update };

  useEffect(() => {
    if (!enabled) return;
    const settle = async (task: EngineTask) => {
      const { update } = latest.current;
      if (!task.context?.cardId || settling.current.has(task.id)) return;
      settling.current.add(task.id);
      let outcome: EngineOutcome = { ok: true };
      try {
        if (task.status === 'succeeded') await placeResult(task, update);
        else {
          const message =
            task.status === 'cancelled'
              ? '已取消，没有发出请求'
              : (task.error?.message ?? '生成失败');
          outcome = { ok: false, message };
          placeFailure(task, message, update);
        }
        await acknowledgeTask(task.id);
      } catch {
        // Left in the engine: the next snapshot (a reconnect or the next launch) tries again.
        settling.current.delete(task.id);
        outcome = { ok: false, message: '结果已经生成，但没能放上画布；重新打开这个项目会再试' };
      }
      waiters.current.get(task.id)?.(outcome);
    };
    const seen = (task: EngineTask) => {
      if (task.context?.projectId !== projectId) return;
      if (isEnded(task.status)) void settle(task);
      else if (task.status === 'running')
        latest.current.update(draft => {
          const job = findCard(draft, task.context?.cardId)?.job;
          if (!job) return;
          job.status = 'running';
          if (task.progress !== undefined) job.progress = task.progress;
        }, false);
    };
    return watchTasks(event => {
      if (event.type === 'snapshot') event.tasks.forEach(seen);
      else if (event.type === 'task') seen(event.task);
    });
  }, [enabled, projectId]);

  /** Hands the task to the engine and waits until its result is on the canvas. */
  async function hand(
    taskId: string,
    cardId: string,
    add: () => Promise<void>,
    signal: AbortSignal,
  ): Promise<EngineOutcome> {
    const done = new Promise<EngineOutcome>(resolve => waiters.current.set(taskId, resolve));
    try {
      await add();
    } catch (error) {
      // Never reached the engine: nothing was sent or charged, so the placeholder can go.
      waiters.current.delete(taskId);
      update(draft => {
        draft.cards = draft.cards.filter(item => item.id !== cardId);
      }, false);
      throw error;
    }
    // Stopping only stops this page from waiting; a queued task is also taken off the queue.
    // A running one finishes anyway, and its result still replaces the placeholder.
    const stop = () => {
      void cancelTask(taskId).catch(() => {});
      waiters.current.get(taskId)?.({ ok: false, message: '已停止本页等待' });
    };
    signal.addEventListener('abort', stop, { once: true });
    try {
      return await done;
    } finally {
      signal.removeEventListener('abort', stop);
      waiters.current.delete(taskId);
    }
  }

  async function run(request: EngineImageRequest, signal: AbortSignal): Promise<EngineOutcome> {
    const { config } = request;
    const cardId = uid();
    const taskId = uid();
    const card = imagePlaceholder(request, cardId, taskId);
    update(draft => placeImageCard(draft, card, request.replace));
    request.onCard?.(cardId);
    return hand(
      taskId,
      cardId,
      () =>
        addImageTask({
          id: taskId,
          provider: config.provider,
          baseUrl: config.baseUrl,
          model: config.imageModel,
          request: {
            prompt: request.prompt,
            references: request.references,
            size: config.imageSize,
          },
          context: { projectId, cardId, label: request.label },
          apiKey: config.key,
        }),
      signal,
    );
  }

  async function runVideo(
    request: EngineVideoRequest,
    signal: AbortSignal,
  ): Promise<EngineOutcome> {
    const { config } = request;
    const preset = PROVIDERS[config.provider];
    const cardId = uid();
    const taskId = uid();
    const card = videoPlaceholder(request, cardId, taskId);
    update(draft => {
      draft.cards.push(card);
      draft.selected = cardId;
    });
    request.onCard?.(cardId);
    return hand(
      taskId,
      cardId,
      () =>
        addVideoTask({
          id: taskId,
          provider: config.provider,
          baseUrl: config.baseUrl,
          model: config.videoModel || preset.defaultVideoModel,
          request: {
            prompt: request.prompt,
            ...(request.reference ? { reference: request.reference } : {}),
            ratio: config.videoRatio,
            duration: Number(config.duration || preset.videoDurations[0] || 5),
            resolution: config.resolution,
          },
          context: { projectId, cardId, label: 'AI 生成视频' },
          apiKey: config.key,
        }),
      signal,
    );
  }

  return enabled ? { run, runVideo } : null;
}
