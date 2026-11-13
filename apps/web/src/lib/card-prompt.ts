import type { Card } from '../types';
import { failedImage } from './failed-image';
import { regeneration } from './regenerate';

/** One thing the prompt under a selected card can start. Each is a new paid request. */
export type PromptAction =
  /** A new image from the text; `replace` puts it where a failed image was. */
  | { kind: 'image'; label: string; replace?: boolean }
  /** A video that starts from this image. */
  | { kind: 'video'; label: string }
  /** Another take of this video, from the same first frame when it had one. */
  | { kind: 'redo'; label: string; source?: Card; unavailable?: string };

export type CardPromptPlan = { text: string; placeholder: string; actions: PromptAction[] };

/** Below this zoom a card is too small to hang a panel on; the panel rests at the bottom. */
export const DOCK_ZOOM = 0.45;

/**
 * What the prompt panel under a selected card offers, or null when it has nothing to offer:
 * media that is missing or still generating, and videos that were not generated here.
 */
export function cardPrompt(card: Card, cards: Card[]): CardPromptPlan | null {
  const text = (card.job?.prompt || card.prompt || '').trim();
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
    return text
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

type Box = { left: number; top: number; right: number; bottom: number };
/**
 * Where the panel goes, in viewport pixels: under the card, or resting at the bottom of the
 * canvas when the card is tiny, out of view, or too low for the panel to fit beneath it.
 */
export function promptPosition(options: {
  card: Box;
  zoom: number;
  size: { width: number; height: number };
  /** Usable canvas area: its width, and the lowest y the panel may reach. */
  bounds: { width: number; bottom: number };
  /** Bottom edge of the action bar when it sits under the card instead of above it. */
  barBottom?: number;
}) {
  const { card, zoom, size, bounds } = options;
  const clampX = (x: number) =>
    Math.min(Math.max(12, x), Math.max(12, bounds.width - size.width - 12));
  const restY = Math.max(48, bounds.bottom - size.height);
  const under = Math.max(card.bottom, options.barBottom ?? 0) + 10;
  const offscreen =
    card.right < 0 || card.left > bounds.width || card.bottom < 0 || card.top > bounds.bottom;
  const docked = zoom < DOCK_ZOOM || offscreen || under > restY;
  // A card that is in view keeps the panel in its own column, so it still reads as that card's.
  const beside = zoom >= DOCK_ZOOM && !offscreen;
  return {
    docked,
    left: clampX(((beside ? card.left + card.right : bounds.width) - size.width) / 2),
    top: docked ? restY : under,
  };
}
