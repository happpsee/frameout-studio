import { describe, expect, it } from 'vitest';
import { initialState, restoreProject, serializeProject } from './project';
import type { Card } from '../../types';

describe('generation records on cards', () => {
  it('keeps the full prompt and the first-frame link through save and load', () => {
    const prompt = '海边的灯塔，黄昏，镜头缓缓推进，远处有一艘返航的渔船，海浪轻拍礁石';
    const cards: Card[] = [
      {
        id: 'img',
        x: 0,
        y: 0,
        name: prompt.slice(0, 18),
        src: 'https://media.example/a.png',
        kind: 'image',
        provider: 'ark',
        prompt,
      },
      {
        id: 'vid',
        x: 300,
        y: 0,
        name: '视频',
        src: 'https://media.example/b.mp4',
        kind: 'video',
        provider: 'ark',
        prompt,
        sourceId: 'img',
      },
      {
        id: 't2v',
        x: 600,
        y: 0,
        name: '视频',
        src: 'https://media.example/c.mp4',
        kind: 'video',
        provider: 'ark',
        prompt,
        sourceId: '',
      },
    ];
    const restored = restoreProject(
      JSON.parse(JSON.stringify(serializeProject({ ...initialState(), cards }))),
    );
    expect(restored.cards.map(card => [card.prompt, card.sourceId])).toEqual([
      [prompt, undefined],
      [prompt, 'img'],
      [prompt, ''],
    ]);
  });
});
