import { describe, expect, it } from 'vitest';
import type { Card, Note } from '../types';
import { rowPick, shotSections } from './shot-list';

const card = (id: string, extra: Partial<Card> = {}): Card => ({
  id,
  x: 0,
  y: 0,
  name: id,
  kind: 'image',
  src: 'blob:a',
  ...extra,
});
const script = (id: string, y: number): Note => ({
  id,
  x: 0,
  y,
  kind: 'script',
  title: id,
  text: '',
});
const job = (status: string) => ({ status }) as Card['job'];

describe('shotSections', () => {
  it('groups shots under their script, in the order they were made, with videos in the row', () => {
    const sections = shotSections({
      notes: [script('第二集', 500), script('第一集', 0), { ...script('备忘', 0), kind: 'text' }],
      cards: [
        card('b', { noteId: '第一集', generatedAt: '2026-11-02', x: 0 }),
        card('a', { noteId: '第一集', generatedAt: '2026-11-01', x: 900 }),
        card('a-video', { kind: 'video', sourceId: 'a', noteId: '第一集' }),
        card('upload'),
      ],
    });
    expect(sections.map(section => section.title)).toEqual(['第一集', '第二集', '其他素材']);
    expect(sections[0].rows.map(row => [row.card.id, row.takes.map(take => take.id)])).toEqual([
      ['a', ['a-video']],
      ['b', []],
    ]);
    expect(sections[1].rows).toEqual([]);
    expect(sections[2].rows.map(row => row.card.id)).toEqual(['upload']);
  });

  it('shows one plain section when there are no scripts', () => {
    expect(shotSections({ cards: [card('a')] }).map(section => section.title)).toEqual([
      '全部素材',
    ]);
    expect(shotSections({ cards: [] })).toEqual([{ id: 'loose', title: '全部素材', rows: [] }]);
  });

  it('keeps a video whose first frame was deleted as a row of its own', () => {
    const [section] = shotSections({
      cards: [card('orphan', { kind: 'video', sourceId: 'gone' })],
    });
    expect(section.rows.map(row => row.card.id)).toEqual(['orphan']);
  });
});

describe('rowPick', () => {
  it('prefers the newest finished video, then the card itself', () => {
    const image = card('image');
    const old = card('old', { kind: 'video', job: job('succeeded') });
    const fresh = card('fresh', { kind: 'video', job: job('succeeded') });
    const running = card('running', { kind: 'video', job: job('running') });
    expect(rowPick({ card: image, takes: [old, fresh, running] })?.id).toBe('fresh');
    expect(rowPick({ card: image, takes: [running] })?.id).toBe('image');
    expect(rowPick({ card: card('failed', { job: job('failed') }), takes: [] })).toBeUndefined();
  });
});
