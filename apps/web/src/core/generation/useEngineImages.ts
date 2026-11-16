import { useEffect, useRef } from 'react';
import type { AIConfig, Card, UpdateProject } from '../../types';
import { isDesktop } from '../../platform';
import { placeholder, preferenceOnly, uid } from '../project/project';
import { putMedia } from '../project/media-store';
import { markImageFailed, placeImageCard } from './failed-image';
import {
  acknowledgeTask,
  addImageTask,
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

/** How a generation ended, for the page that is still waiting on it. */
export type EngineImageOutcome = { ok: true } | { ok: false; message: string };

type Options = {
  projectId: string;
  update: UpdateProject;
};

/**
 * Desktop only: image generations go to the local task engine, so they finish even when the
 * window closes. A placeholder card waits on the canvas; when the task ends, the result (or the
 * reason it failed) takes its place, now or the next time this project opens.
 */
export function useEngineImages({ projectId, update }: Options) {
  const enabled = isDesktop();
  const waiters = useRef(new Map<string, (outcome: EngineImageOutcome) => void>());
  const settling = useRef(new Set<string>());
  const latest = useRef({ update });
  latest.current = { update };

  useEffect(() => {
    if (!enabled) return;
    const settle = async (task: EngineTask) => {
      const { update } = latest.current;
      const cardId = task.context?.cardId;
      if (!cardId || settling.current.has(task.id)) return;
      settling.current.add(task.id);
      let outcome: EngineImageOutcome = { ok: true };
      try {
        if (task.status === 'succeeded') {
          const blob = await taskResult(task.id);
          const mediaId = await putMedia(blob);
          const src = URL.createObjectURL(blob);
          update(draft => {
            const card = draft.cards.find(item => item.id === cardId);
            if (!card) return;
            Object.assign(card, { src, mediaId, mimeType: blob.type, kind: 'image' });
            card.label = task.context?.label ?? 'AI 生成图片';
            card.generatedAt = new Date().toISOString();
            delete card.job;
          }, false);
        } else {
          const message =
            task.status === 'cancelled'
              ? '已取消，没有发出请求'
              : (task.error?.message ?? '生成失败');
          outcome = { ok: false, message };
          update(draft => {
            const card = draft.cards.find(item => item.id === cardId);
            if (!card?.job) return;
            markImageFailed(card, message, { ...card.job.config, key: '' });
            for (const step of draft.workflow?.steps ?? [])
              if (step.outputCardId === cardId) {
                step.status = 'failed';
                step.error = message;
              }
          }, false);
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
          const job = draft.cards.find(item => item.id === task.context?.cardId)?.job;
          if (job) job.status = 'running';
        }, false);
    };
    return watchTasks(event => {
      if (event.type === 'snapshot') event.tasks.forEach(seen);
      else if (event.type === 'task') seen(event.task);
    });
  }, [enabled, projectId]);

  /** Places the placeholder, hands the task to the engine and waits until its result is on the canvas. */
  async function run(
    request: EngineImageRequest,
    signal: AbortSignal,
  ): Promise<EngineImageOutcome> {
    const { config } = request;
    const cardId = uid();
    const taskId = uid();
    const card: Card = {
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
    update(draft => placeImageCard(draft, card, request.replace));
    request.onCard?.(cardId);
    const done = new Promise<EngineImageOutcome>(resolve => waiters.current.set(taskId, resolve));
    try {
      await addImageTask({
        id: taskId,
        provider: config.provider,
        baseUrl: config.baseUrl,
        model: config.imageModel,
        request: { prompt: request.prompt, references: request.references, size: config.imageSize },
        context: { projectId, cardId, label: request.label },
        apiKey: config.key,
      });
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

  return enabled ? { run } : null;
}
