import { describe, expect, it } from 'vitest';
import type { Card, ProjectState } from '../types';
import { cardsInRect, rectBetween, removeCards, visualOrder } from './canvas-selection';

const card = (id: string, x: number, y: number): Card => ({
  id,
  x,
  y,
  name: id,
  src: `/${id}.png`,
  kind: 'image',
});

describe('canvas selection helpers', () => {
  it('builds a rectangle from a drag in any direction', () => {
    expect(rectBetween({ x: 50, y: 40 }, { x: 10, y: 60 })).toEqual({
      left: 10,
      top: 40,
      width: 40,
      height: 20,
    });
  });
  it('finds cards that touch the box', () => {
    const cards = [card('a', 0, 0), card('b', 500, 0), card('c', 0, 500)];
    expect(cardsInRect(cards, { left: 260, top: 200, width: 300, height: 10 })).toEqual(['a', 'b']);
  });
  it('orders cards left to right, then top to bottom within a column', () => {
    const cards = [card('right', 600, 0), card('low', 40, 300), card('high', 0, 0)];
    expect(visualOrder(cards).map(c => c.id)).toEqual(['high', 'low', 'right']);
  });
  it('removes cards with their shots, references and selection', () => {
    const draft: ProjectState = {
      version: 1,
      title: 't',
      camera: { x: 0, y: 0, zoom: 1 },
      selected: 'a',
      cards: [card('a', 0, 0), card('b', 0, 0), card('c', 0, 0)],
      sequence: [
        { id: 's1', cardId: 'a', duration: 4 },
        { id: 's2', cardId: 'c', duration: 4 },
      ],
      consistency: { notes: '', references: ['b', 'c'] },
    };
    removeCards(draft, ['a', 'b']);
    expect(draft.cards.map(c => c.id)).toEqual(['c']);
    expect(draft.sequence.map(s => s.id)).toEqual(['s2']);
    expect(draft.consistency?.references).toEqual(['c']);
    expect(draft.selected).toBeNull();
  });
});
