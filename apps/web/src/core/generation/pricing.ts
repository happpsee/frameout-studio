import { PROVIDERS } from '@frameout/shared';
import type { Card } from '../../types';
import { failedImage } from './failed-image';

// Prices in yuan, from Volcano Ark's billing page (docs.volcengine.com/docs/82379/1544106),
// updated there on 2026-11-17. Only what this app generates with by default is listed; any
// other model shows no price rather than a guess. Update this table when Ark changes prices.

/** Per output image by pixel count, and per reference image after the first (which is free). */
const IMAGE: Record<string, { small: number; large: number; input: number }> = {
  'doubao-seedream-5-0-pro': { small: 0.3, large: 0.6, input: 0.02 },
};
/** Above this many pixels an image costs the larger price. */
const LARGE_PIXELS = 2.61e6;
/** Pixels of the sizes this app asks for; 2K and 4K are past the line at any aspect ratio. */
const SIZE_PIXELS: Record<string, number> = {
  '1K': 1024 * 1024,
  '2K': 2048 * 2048,
  '4K': 4096 * 4096,
};

/** Per second of a 16:9 video whose input has no video in it, by output resolution. */
const VIDEO: Record<string, Record<string, number>> = {
  'doubao-seedance-2-5': { '480p': 0.67, '720p': 1.51, '1080p': 3.74, '4k': 6.03 },
  'doubao-seedance-2-5-flash': { '480p': 0.44, '720p': 0.99 },
};

/** Model ids carry a date suffix (…-260628); prices are listed by the name before it. */
const family = (model: string) => model.replace(/-\d{6}$/, '');

const referencesIn = (card: Card) =>
  card.referenceIds?.length ?? Number(/参考 (\d+)/.exec(card.label ?? '')?.[1] ?? 0);

/**
 * About what a generated card cost, in yuan, or null when it was not generated here, failed,
 * is still running, or was made with a model whose price is not listed.
 */
export function estimateCost(card: Card): number | null {
  if (card.provider !== 'ark' || failedImage(card) || card.missingMedia) return null;
  const preset = PROVIDERS.ark;
  if (card.kind === 'video') {
    if (card.job?.status !== 'succeeded' || !card.duration) return null;
    const model = card.job.config.videoModel || card.model || preset.defaultVideoModel;
    const perSecond =
      VIDEO[family(model)]?.[String(card.job.config.resolution ?? '720p').toLowerCase()];
    return perSecond ? round(perSecond * Math.round(card.duration)) : null;
  }
  if (card.job || !card.generatedAt) return null;
  const price = IMAGE[family(card.model || preset.defaultImageModel)];
  if (!price) return null;
  const pixels = SIZE_PIXELS[card.size ?? '2K'] ?? SIZE_PIXELS['2K'];
  const output = pixels > LARGE_PIXELS ? price.large : price.small;
  return round(output + Math.max(0, referencesIn(card) - 1) * price.input);
}

const round = (yuan: number) => Math.round(yuan * 100) / 100;

/** About what the generated cards on the canvas cost, in yuan; unpriced cards count as 0. */
export function projectCost(cards: Card[]) {
  let total = 0;
  for (const card of cards) total += estimateCost(card) ?? 0;
  return round(total);
}

export const formatYuan = (yuan: number) => `¥${yuan.toFixed(2)}`;
