import { describe, expect, it } from 'vitest';
import { normalizeConsistency, referenceCards, supportsReferences, withNotes } from './consistency';
import { restoreProject, serializeProject, initialState } from './project';
import type { Card } from '../types';

const image = (id: string, extra: Partial<Card> = {}): Card => ({
  id,
  x: 0,
  y: 0,
  name: id,
  kind: 'image',
  src: `https://media.example/${id}.png`,
  ...extra,
});

describe('shot consistency settings', () => {
  it('keeps only existing, distinct image references, at most four', () => {
    const cards = ['a', 'b', 'c', 'd', 'e']
      .map(id => image(id))
      .concat(image('clip', { kind: 'video' }));
    expect(
      normalizeConsistency(
        { notes: '  红色雨衣  ', references: ['a', 'a', 'clip', 'gone', 'b', 'c', 'd', 'e'] },
        cards,
      ),
    ).toEqual({ notes: '红色雨衣', references: ['a', 'b', 'c', 'd'] });
    expect(normalizeConsistency({ notes: ' ', references: ['gone'] }, cards)).toBeUndefined();
    expect(normalizeConsistency('nope', cards)).toBeUndefined();
  });
  it('sends only readable, finished images and appends notes to prompts', () => {
    const cards = [
      image('ok'),
      image('lost', { missingMedia: true }),
      image('job', {
        job: { id: '', provider: 'ark', status: 'running', prompt: '', config: {} as never },
      }),
    ];
    expect(
      referenceCards({ cards, consistency: { notes: '', references: ['lost', 'ok', 'job'] } }).map(
        card => card.id,
      ),
    ).toEqual(['ok']);
    expect(withNotes('雨夜回头', '红色雨衣')).toBe(
      '雨夜回头\n\n统一设定（所有镜头保持一致）：红色雨衣',
    );
    expect(withNotes('雨夜回头', '  ')).toBe('雨夜回头');
    expect([
      supportsReferences('openai'),
      supportsReferences('ark'),
      supportsReferences('compatible'),
    ]).toEqual([true, true, false]);
  });
  it('round-trips with the project and drops references to removed or session-only cards', () => {
    const project = {
      ...initialState(),
      cards: [image('keep'), image('temp', { sessionOnly: true })],
      consistency: { notes: '冷色调', references: ['keep', 'temp'] },
    };
    const saved = serializeProject(project);
    expect(saved.consistency).toEqual({ notes: '冷色调', references: ['keep'] });
    expect(restoreProject(JSON.parse(JSON.stringify(saved))).consistency).toEqual({
      notes: '冷色调',
      references: ['keep'],
    });
  });
});
