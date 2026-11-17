import { expect, test } from 'vitest';
import type { Card } from '../../types';
import { draftCard } from '../canvas/card-links';
import { cardPrompt } from './card-prompt';

test('a draft card fills itself with an image, or turns into a video', () => {
  const draft = draftCard('a', { x: 0, y: 0 });
  expect(cardPrompt(draft, [draft])?.actions).toEqual([
    { kind: 'image', label: '生成图片', replace: true },
    { kind: 'video', label: '生成视频' },
  ]);
});

test('an image with a note linked in can make a new image, not only a video', () => {
  const card = { id: 'c', x: 0, y: 0, name: 'c', src: '', kind: 'image', textIds: ['n'] } as Card;
  expect(cardPrompt(card, [card])?.actions.map(action => action.kind)).toEqual(['image', 'video']);
});
