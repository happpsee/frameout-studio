import { expect, test } from 'vitest';
import type { Card, ProjectState } from '../../types';
import { projectSummary } from './project-summary';

const card = (id: string, extra: Partial<Card> = {}) =>
  ({ id, x: 0, y: 0, name: id, src: '', kind: 'image', ...extra }) as Card;

test('an agent sees the cards, the lines between them and the film in order', () => {
  const project = {
    title: 't',
    camera: { x: 0, y: 0, zoom: 1 },
    selected: null,
    version: 1,
    cards: [card('face'), card('shot', { kind: 'video', sourceId: 'face', duration: 5 })],
    sequence: [{ id: 's1', cardId: 'shot', duration: 5 }],
  } as ProjectState;
  const summary = projectSummary(project);
  expect(summary.cards.map(item => item.id)).toEqual(['face', 'shot']);
  expect(summary.lines).toEqual([{ from: 'face', to: 'shot', kind: 'first-frame', label: '首帧' }]);
  expect(summary.film.shots).toEqual([{ number: 1, id: 's1', cardId: 'shot', seconds: 5 }]);
});
