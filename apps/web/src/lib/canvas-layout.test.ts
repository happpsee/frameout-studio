import { describe, expect, it } from 'vitest';
import type { Card, Note } from '../types';
import { arrange, tidy } from './canvas-layout';

const card = (id: string, x: number, y: number, extra: Partial<Card> = {}): Card => ({
  id,
  x,
  y,
  name: id,
  kind: 'image',
  src: 'blob:a',
  ...extra,
});
const note = (id: string, x: number, y: number, kind: Note['kind'] = 'script'): Note => ({
  id,
  x,
  y,
  kind,
  title: id,
  text: '',
});
const at = (positions: Map<string, { x: number; y: number }>, id: string) => positions.get(id);

describe('arrange', () => {
  const scattered = [
    card('c', 900, 40),
    card('a', 100, 50),
    card('b', 500, 400),
    card('d', 950, 600),
  ];

  it('lays cards out in a grid in reading order from their top-left corner', () => {
    const grid = arrange(scattered, 'grid');
    expect(at(grid, 'a')).toEqual({ x: 100, y: 40 });
    expect(at(grid, 'b')).toEqual({ x: 400, y: 40 });
    expect(at(grid, 'c')).toEqual({ x: 100, y: 289 });
    expect(at(grid, 'd')).toEqual({ x: 400, y: 289 });
  });

  it('makes a single row or a single column', () => {
    expect([...arrange(scattered, 'row').values()].map(point => point.y)).toEqual([40, 40, 40, 40]);
    expect([...arrange(scattered, 'column').values()].map(point => point.x)).toEqual([
      100, 100, 100, 100,
    ]);
    expect(arrange([], 'grid').size).toBe(0);
  });
});

describe('tidy', () => {
  it('puts each script beside its results, a first frame next to its video', () => {
    const result = tidy({
      notes: [note('s1', 50, 50), note('t1', 900, 900, 'text')],
      cards: [
        card('video', 700, 700, { kind: 'video', sourceId: 'frame', noteId: 's1' }),
        card('frame', 20, 800, { noteId: 's1' }),
        card('other', 300, 300, { noteId: 's1' }),
        card('loose', 1200, 20),
      ],
    });
    expect(at(result.notes, 's1')).toEqual({ x: 20, y: 20 });
    // The video was made from `frame`, so it follows it even though `other` is further left.
    expect(at(result.cards, 'frame')).toEqual({ x: 380, y: 20 });
    expect(at(result.cards, 'video')).toEqual({ x: 680, y: 20 });
    expect(at(result.cards, 'other')).toEqual({ x: 980, y: 20 });
    // Text notes and cards without a script start below the script's block.
    expect(at(result.notes, 't1')).toEqual({ x: 20, y: 300 });
    expect(at(result.cards, 'loose')).toEqual({ x: 380, y: 300 });
  });

  it('uses the full width when there are no notes, and wraps after four cards', () => {
    const cards = [0, 1, 2, 3, 4].map(n => card(`c${n}`, 10 + n * 400, 10));
    const result = tidy({ cards });
    expect(at(result.cards, 'c0')).toEqual({ x: 10, y: 10 });
    expect(at(result.cards, 'c4')).toEqual({ x: 10, y: 259 });
    expect(tidy({ cards: [] }).cards.size).toBe(0);
  });
});
