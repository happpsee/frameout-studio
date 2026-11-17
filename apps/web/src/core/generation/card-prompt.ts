import type { Card } from '../../types';
import { failedImage } from './failed-image';
import { regeneration } from './regenerate';
import { DRAFT_LABEL } from '../canvas/card-links';

/** One thing the prompt box on a card can start. Each is a new paid request. */
export type PromptAction =
  /** A new image from the text; `replace` puts it where a failed image was. */
  | { kind: 'image'; label: string; replace?: boolean }
  /** A video that starts from this image. */
  | { kind: 'video'; label: string }
  /** Another take of this video, from the same first frame when it had one. */
  | { kind: 'redo'; label: string; source?: Card; unavailable?: string };

export type CardPromptPlan = { text: string; placeholder: string; actions: PromptAction[] };

/**
 * What the prompt box on a card offers, or null when it has nothing to offer:
 * media that is missing or still generating, and videos that were not generated here.
 */
export function cardPrompt(card: Card, cards: Card[]): CardPromptPlan | null {
  const text = (card.job?.prompt || card.prompt || '').trim();
  if (card.label === DRAFT_LABEL)
    return {
      text,
      placeholder: '描述要生成的画面，连进来的卡片会作为参考',
      actions: [
        { kind: 'image', label: '生成图片', replace: true },
        { kind: 'video', label: '生成视频' },
      ],
    };
  if (failedImage(card))
    return {
      text,
      placeholder: '改一改描述，再试一次',
      actions: [{ kind: 'image', label: '重新生成', replace: true }],
    };
  if (card.missingMedia) return null;
  if (card.kind === 'image') {
    if (card.job) return null;
    const video: PromptAction = { kind: 'video', label: '图生视频' };
    // Words linked in from a note count as a description too.
    return text || card.textIds?.length
      ? {
          text,
          placeholder: '描述画面，或写下运镜和动作',
          actions: [{ kind: 'image', label: '生成图片' }, video],
        }
      : { text, placeholder: '写下运镜或动作，让这张图动起来', actions: [video] };
  }
  const plan = regeneration(card, cards);
  if (!plan || !text || (card.job && card.job.status !== 'succeeded')) return null;
  return {
    text,
    placeholder: '描述镜头里的运动',
    actions: [
      plan.ok
        ? { kind: 'redo', label: '再来一条', source: plan.source }
        : { kind: 'redo', label: '再来一条', unavailable: plan.reason },
    ],
  };
}
