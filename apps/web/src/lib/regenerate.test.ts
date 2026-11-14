import { describe, expect, it } from 'vitest';
import { regeneration } from './regenerate';
import { preferenceOnly } from './project';
import { defaults } from './preferences';
import { failedImageCard } from './failed-image';
import type { Card, VideoJob } from '../types';

const image: Card = {
  id: 'img',
  x: 0,
  y: 0,
  name: '海边',
  src: 'blob:image',
  kind: 'image',
  provider: 'ark',
  prompt: '海边的灯塔，黄昏',
};
function video(status: string, sourceId?: string): Card {
  const job: VideoJob = {
    id: 'task-1',
    provider: 'ark',
    status,
    prompt: '镜头缓缓推进',
    config: preferenceOnly(defaults('ark')),
  };
  return {
    id: 'vid',
    x: 300,
    y: 0,
    name: '镜头 · 视频',
    src: 'blob:video',
    kind: 'video',
    provider: 'ark',
    prompt: '镜头缓缓推进',
    job,
    ...(sourceId === undefined ? {} : { sourceId }),
  };
}

describe('regeneration', () => {
  it('reuses the first frame of an image-to-video card while it is available', () => {
    const card = video('succeeded', 'img');
    expect(regeneration(card, [image, card])).toMatchObject({
      ok: true,
      mode: 'video',
      source: image,
    });
    expect(regeneration(card, [card])).toMatchObject({
      ok: false,
      reason: expect.stringContaining('首帧'),
    });
    expect(regeneration(card, [{ ...image, missingMedia: true }, card])).toMatchObject({
      ok: false,
    });
  });
  it('refuses while the task may still run or when the first frame was not recorded', () => {
    expect(regeneration(video('running', ''), [])).toMatchObject({ ok: false });
    expect(regeneration(video('paused', ''), [])).toMatchObject({
      ok: false,
      reason: expect.stringContaining('避免重复付费'),
    });
    expect(regeneration(video('succeeded'), [])).toMatchObject({ ok: false });
  });
  it('retries a failed image in its place', () => {
    const failed = failedImageCard(
      '海边的灯塔，黄昏',
      '内容被供应商的安全审核拒绝',
      defaults('ark'),
      { x: 0, y: 0 },
    );
    expect(regeneration(failed, [failed])).toEqual({
      ok: true,
      prompt: '海边的灯塔，黄昏',
      mode: 'image',
      replaces: true,
    });
  });
});
