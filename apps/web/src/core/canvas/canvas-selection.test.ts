import { describe, expect, it } from 'vitest';
import type { Card, ProjectState } from '../../types';
import { removeCards } from './canvas-selection';

const card = (id: string, x: number, y: number): Card => ({
  id,
  x,
  y,
  name: id,
  src: `/${id}.png`,
  kind: 'image',
});

describe('canvas selection helpers', () => {
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
