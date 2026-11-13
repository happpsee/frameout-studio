import { describe, expect, it } from 'vitest';
import type { Card } from '../types';
import { cardPrompt, promptPosition } from './card-prompt';
import { FAILED_IMAGE_LABEL } from './failed-image';

const card = (value: Partial<Card> = {}): Card => ({
  id: 'c1',
  x: 0,
  y: 0,
  name: '画面',
  kind: 'image',
  src: 'blob:a',
  ...value,
});
const job = (status: string) =>
  ({ id: 'task', provider: 'ark', status, prompt: '海边日落', config: {} }) as Card['job'];
const kinds = (value: Card, cards: Card[] = []) =>
  cardPrompt(value, cards)?.actions.map(action => action.kind);

describe('cardPrompt', () => {
  it('offers a new image and a video for a generated image, starting from its prompt', () => {
    const plan = cardPrompt(card({ provider: 'ark', prompt: ' 森林里的探险者 ' }), []);
    expect(plan?.text).toBe('森林里的探险者');
    expect(plan?.actions.map(action => action.label)).toEqual(['生成图片', '图生视频']);
  });

  it('offers only a video for an imported image, with nothing prefilled', () => {
    const plan = cardPrompt(card(), []);
    expect(plan?.text).toBe('');
    expect(plan?.actions.map(action => action.kind)).toEqual(['video']);
  });

  it('retries a failed image in place', () => {
    const failed = card({ label: FAILED_IMAGE_LABEL, job: job('failed'), provider: 'ark' });
    expect(cardPrompt(failed, [])?.actions).toEqual([
      { kind: 'image', label: '重新生成', replace: true },
    ]);
  });

  it('retakes a finished video from the same first frame', () => {
    const frame = card({ id: 'frame' });
    const video = card({ id: 'v', kind: 'video', sourceId: 'frame', job: job('succeeded') });
    expect(cardPrompt(video, [frame, video])?.actions).toEqual([
      { kind: 'redo', label: '再来一条', source: frame },
    ]);
  });

  it('keeps the retake visible with its reason when the first frame is gone', () => {
    const video = card({ id: 'v', kind: 'video', sourceId: 'gone', job: job('succeeded') });
    const [action] = cardPrompt(video, [video])!.actions;
    expect(action).toMatchObject({ kind: 'redo', unavailable: '用作首帧的图片已删除或不可用' });
  });

  it('offers nothing for media that is missing, still generating, or an imported video', () => {
    expect(kinds(card({ missingMedia: true }))).toBeUndefined();
    expect(kinds(card({ kind: 'video', sourceId: '', job: job('running') }))).toBeUndefined();
    expect(kinds(card({ kind: 'video' }))).toBeUndefined();
  });
});

describe('promptPosition', () => {
  const size = { width: 360, height: 120 };
  const bounds = { width: 1200, bottom: 700 };
  const box = { left: 400, top: 200, right: 670, bottom: 419 };

  it('sits centred under the card', () => {
    expect(promptPosition({ card: box, zoom: 1, size, bounds })).toEqual({
      docked: false,
      left: 355,
      top: 429,
    });
  });

  it('goes under the action bar when the bar is below the card', () => {
    expect(promptPosition({ card: box, zoom: 1, size, bounds, barBottom: 480 }).top).toBe(490);
  });

  it('rests at the bottom when the card is tiny, out of view, or too low', () => {
    const rest = { docked: true, left: 420, top: 580 };
    expect(promptPosition({ card: box, zoom: 0.3, size, bounds })).toEqual(rest);
    const away = { left: 1300, top: 200, right: 1570, bottom: 419 };
    expect(promptPosition({ card: away, zoom: 1, size, bounds })).toEqual(rest);
    // Too low to fit underneath, but in view: it rests in the card's own column.
    const low = { left: 400, top: 400, right: 670, bottom: 619 };
    expect(promptPosition({ card: low, zoom: 1, size, bounds })).toEqual({ ...rest, left: 355 });
  });

  it('stays inside the canvas at its edges', () => {
    const edge = { left: -100, top: 100, right: 170, bottom: 319 };
    expect(promptPosition({ card: edge, zoom: 1, size, bounds }).left).toBe(12);
  });
});
