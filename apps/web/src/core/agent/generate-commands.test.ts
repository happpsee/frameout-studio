import { expect, test, vi } from 'vitest';
import type { AIConfig, Card, ProjectState } from '../../types';
import { generateVideo, type GenerateDeps } from './generate-commands';

const image = { id: 'i', x: 0, y: 0, name: '耄耋', src: 'blob:x', kind: 'image' } as Card;
const deps = (): GenerateDeps => ({
  project: { cards: [image], sequence: [] } as unknown as ProjectState,
  engine: { run: vi.fn(), runVideo: vi.fn() },
  config: {
    provider: 'ark',
    key: 'k',
    duration: 5,
    resolution: '720p',
    videoRatio: '9:16',
  } as AIConfig,
  toast: vi.fn(),
});

test('a dry run only quotes: nothing is sent to the engine', async () => {
  const d = deps();
  const result = await generateVideo(d, { prompt: '哈气', duration: 6, dryRun: true });
  expect(result.estimatedYuan).toBeGreaterThan(0);
  expect(d.engine!.runVideo).not.toHaveBeenCalled();
});

test('a first frame and reference images are refused together, before anything is sent', async () => {
  const d = deps();
  await expect(generateVideo(d, { prompt: 'x', firstFrame: 'i', images: ['i'] })).rejects.toThrow(
    '不能同时用',
  );
  expect(d.engine!.runVideo).not.toHaveBeenCalled();
});
