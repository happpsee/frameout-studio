import { expect, test } from 'vitest';
import type { Card, ProjectState } from '../../types';
import { restoreProject, serializeProject } from '../project/project';
import { filmLinks, removeShot } from './film-node';

const card = (id: string) => ({ id, x: 0, y: 0, name: id, src: '', kind: 'video' }) as Card;
const shots = [
  { id: 's1', cardId: 'b', duration: 5 },
  { id: 's2', cardId: 'a', duration: 5 },
];

test('film lines follow the film order, so reordering the list renumbers them', () => {
  expect(filmLinks(shots, [card('a'), card('b')]).map(link => [link.from, link.label])).toEqual([
    ['b', '镜头 1'],
    ['a', '镜头 2'],
  ]);
});

test('deleting a film line takes that shot out; other lines are left alone', () => {
  const draft = { sequence: [...shots] } as ProjectState;
  expect(removeShot(draft, 'film:s1')).toBe(true);
  expect(draft.sequence.map(shot => shot.id)).toEqual(['s2']);
  expect(removeShot(draft, 'a>b:reference')).toBe(false);
});

test('where the film card was put is saved and restored', () => {
  const project = restoreProject({
    version: 1,
    title: 't',
    camera: { x: 0, y: 0, zoom: 1 },
    selected: null,
    cards: [{ ...card('a'), mediaId: 'm' }],
    sequence: [],
    film: { x: 900, y: 40 },
  });
  expect(serializeProject(project).film).toEqual({ x: 900, y: 40 });
});
