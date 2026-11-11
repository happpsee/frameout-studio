import { describe, expect, it } from 'vitest';
import { visibleCards } from './CanvasCard';
import type { Card } from '../types';

const card = (id: string, x: number, y: number): Card => ({ id, x, y, name: id, kind: 'image', src: '' });

describe('canvas viewport culling', () => {
  const cards = [card('inside', 100, 100), card('edge', 1300, 100), card('far', 5000, 5000), card('pinned', -4000, 0)];
  it('keeps cards within the viewport and margin, plus pinned ones', () => {
    const visible = visibleCards(cards, { x: 0, y: 0, zoom: 1 }, 1200, 800, ['pinned']).map(item => item.id);
    expect(visible).toEqual(['inside', 'edge', 'pinned']);
  });
  it('accounts for camera offset and zoom', () => {
    const visible = visibleCards(cards, { x: -5000 * 0.5, y: -5000 * 0.5, zoom: 0.5 }, 1200, 800, []).map(item => item.id);
    expect(visible).toEqual(['far']);
  });
});
