import { expect, test } from 'vitest';
import { CARD_HEIGHT, CARD_WIDTH } from './canvas-camera';
import { freeSpot } from './canvas-layout';

const covers = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.abs(a.x - b.x) < CARD_WIDTH && Math.abs(a.y - b.y) < CARD_HEIGHT;

test('a new card goes where it is asked when nothing is there', () => {
  expect(freeSpot([{ x: 0, y: 0 }], { x: 1000, y: 0 })).toEqual({ x: 1000, y: 0 });
});

test('a new card never covers a card already on the canvas', () => {
  const cards = [-300, 0, 300].flatMap(x => [-250, 0, 250].map(y => ({ x: x + 10, y: y + 10 })));
  const spot = freeSpot(cards, { x: 0, y: 0 });
  expect(cards.some(card => covers(card, spot))).toBe(false);
});
