import { describe, expect, it } from 'vitest';
import type { Card } from '../types';
import { CARD_WIDTH } from './canvas-camera';
import { exampleCards, findExample, requestExample, takeExampleRequest } from './examples';
import { EXAMPLE_LABEL, initialState, restoreProject, serializeProject } from './project';

const forest = findExample('forest')!;
const userCard = (id: string, x: number, y: number): Card => ({
  id,
  x,
  y,
  name: id,
  kind: 'image',
  src: `https://media.example/${id}.png`,
});

describe('landing examples on the canvas', () => {
  it('hands the clicked example to the studio once', () => {
    requestExample('ocean');
    expect(takeExampleRequest()?.name).toBe('潮汐之后');
    expect(takeExampleRequest()).toBeUndefined();
  });

  it('places example images on an empty canvas at the given point, marked as samples', () => {
    const { added, cards } = exampleCards(forest, [], { x: 10, y: 20 });
    expect(added).toEqual(cards);
    expect(added[0]).toMatchObject({
      x: 10,
      y: 20,
      kind: 'image',
      src: '/assets/forest-astronaut.webp',
      label: EXAMPLE_LABEL,
    });
  });

  it('adds next to existing work without moving or covering it', () => {
    const existing = [userCard('a', -50, 40), userCard('b', 300, 10)];
    const { added } = exampleCards(forest, existing, { x: 0, y: 0 });
    expect(added[0].x).toBeGreaterThanOrEqual(300 + CARD_WIDTH);
    expect(added[0].y).toBe(10);
    expect(existing.map(card => [card.x, card.y])).toEqual([
      [-50, 40],
      [300, 10],
    ]);
  });

  it('reuses example images already on the canvas instead of duplicating them', () => {
    const first = exampleCards(forest, [], { x: 0, y: 0 }).added;
    const again = exampleCards(forest, first, { x: 0, y: 0 });
    expect(again.added).toEqual([]);
    expect(again.cards).toEqual(first);
  });

  it('keeps example cards after a reload, unlike the old built-in samples', () => {
    const project = { ...initialState(), cards: exampleCards(forest, [], { x: 0, y: 0 }).added };
    const restored = restoreProject(JSON.parse(JSON.stringify(serializeProject(project))));
    expect(restored.cards).toHaveLength(1);
    expect(restored.cards[0].label).toBe(EXAMPLE_LABEL);
  });
});
