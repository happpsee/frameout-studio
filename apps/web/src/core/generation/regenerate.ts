import type { Card, GenerationMode } from '../../types';
import { failedImage } from './failed-image';

export type Regeneration =
  /** `replaces`: the card is a failed image, and the new result takes its place. */
  | { ok: true; prompt: string; mode: GenerationMode; source?: Card; replaces?: boolean }
  | { ok: false; mode: GenerationMode; reason: string };

const FINISHED = ['succeeded', 'failed', 'rejected', 'cancelled'];

/**
 * What "再来一张" would run for a card: the same kind of generation with its prompt.
 * Returns null for cards that were not generated, so the action is not offered.
 */
export function regeneration(card: Card, cards: Card[]): Regeneration | null {
  const prompt = (card.job?.prompt || card.prompt || '').trim();
  if (!prompt || !(card.provider || card.job)) return null;
  if (!card.job) return { ok: true, prompt, mode: 'image' };
  if (failedImage(card)) return { ok: true, prompt, mode: 'image', replaces: true };
  const mode = 'video';
  if (!FINISHED.includes(card.job.status))
    return {
      ok: false,
      mode,
      reason:
        card.job.status === 'paused'
          ? '这条任务可能还在供应商执行，先继续查询，避免重复付费'
          : '这条视频还在生成，等它结束再来',
    };
  // Older cards did not record whether a first frame was used.
  if (card.sourceId === undefined)
    return { ok: false, mode, reason: '这条视频没有记下用的首帧，无法原样再来' };
  if (!card.sourceId) return { ok: true, prompt, mode };
  const source = cards.find(item => item.id === card.sourceId);
  if (!source || source.missingMedia || source.kind !== 'image' || source.job)
    return { ok: false, mode, reason: '用作首帧的图片已删除或不可用' };
  return { ok: true, prompt, mode, source };
}
