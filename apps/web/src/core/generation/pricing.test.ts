import { expect, test } from 'vitest';
import type { AIConfig, Card } from '../../types';
import { estimateCost, projectCost, quote } from './pricing';

const image = (extra: Partial<Card> = {}) =>
  ({
    id: 'i',
    x: 0,
    y: 0,
    name: 'i',
    src: '',
    kind: 'image',
    provider: 'ark',
    size: '2K',
    generatedAt: '2026-11-17',
    ...extra,
  }) as Card;

test('a 2K Seedream 5.0 Pro image costs 0.60, plus 0.02 for each reference after the first', () => {
  expect(estimateCost(image())).toBe(0.6);
  expect(estimateCost(image({ label: 'AI 生成图片 · 参考 2' }))).toBe(0.62);
});

test('a 5 second 720p Seedance 2.5 video costs about 7.55, and unpriced cards count as nothing', () => {
  const video = image({
    kind: 'video',
    duration: 5.056,
    job: {
      id: 'j',
      provider: 'ark',
      status: 'succeeded',
      prompt: '',
      config: { videoModel: 'doubao-seedance-2-5-260628', resolution: '720p' },
    },
  } as Partial<Card>);
  expect(estimateCost(video)).toBe(7.55);
  expect(estimateCost(image({ provider: undefined }))).toBeNull();
  expect(projectCost([image(), video, image({ provider: undefined })])).toBe(8.15);
});

test('the price is known before generating, from the settings and the references sent', () => {
  const config = { provider: 'ark', imageSize: '2K', resolution: '720p', duration: 5 } as AIConfig;
  expect(quote(config, 'image', 3)).toBe(0.64);
  expect(quote(config, 'video')).toBe(7.55);
  expect(quote({ ...config, provider: 'openai' } as AIConfig, 'image')).toBeNull();
});
