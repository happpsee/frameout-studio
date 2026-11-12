import { describe, expect, it } from 'vitest';
import {
  ExportError,
  exportSequence,
  fitRect,
  objectPosition,
  shotFrameTimes,
} from './export-video';
import type { Card } from '../types';

const card: Card = {
  id: 'a',
  x: 0,
  y: 0,
  name: '镜头',
  kind: 'image',
  src: 'data:image/png;base64,AA==',
};

describe('sequence export layout and timing', () => {
  it('gives each shot whole frames at the export frame rate', () => {
    expect(shotFrameTimes(1, 30)).toHaveLength(30);
    expect(shotFrameTimes(4, 30).at(-1)).toBeCloseTo(119 / 30);
    expect(shotFrameTimes(0.01, 30)).toEqual([0]);
  });
  it('reads object-position like the preview CSS', () => {
    expect(objectPosition()).toEqual({ x: 0.5, y: 0.5 });
    expect(objectPosition('20% 0')).toEqual({ x: 0.2, y: 0 });
    expect(objectPosition('left bottom')).toEqual({ x: 0, y: 1 });
    expect(objectPosition('top')).toEqual({ x: 0.5, y: 0 });
  });
  it('letterboxes with contain and crops with cover', () => {
    const target = { width: 1280, height: 720 };
    expect(fitRect({ width: 1000, height: 1000 }, target, 'contain')).toEqual({
      x: 280,
      y: 0,
      width: 720,
      height: 720,
    });
    const cover = fitRect({ width: 1000, height: 1000 }, target, 'cover', { x: 0.5, y: 0 });
    expect([cover.x, cover.y, cover.width, cover.height].map(Math.abs)).toEqual([0, 0, 1280, 1280]);
  });
  it('explains when there is nothing to export or no encoder', async () => {
    await expect(exportSequence([], { width: 1280, height: 720 })).rejects.toThrow(
      '还没有可导出的镜头',
    );
    await expect(
      exportSequence([{ card, duration: 1 }], { width: 1280, height: 720 }),
    ).rejects.toBeInstanceOf(ExportError);
  });
});
