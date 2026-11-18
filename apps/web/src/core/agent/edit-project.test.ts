import { expect, test } from 'vitest';
import type { Card, ProjectState } from '../../types';
import { applyOperations, projectVersion } from './edit-project';

const card = (id: string, kind: Card['kind'] = 'video') =>
  ({ id, x: 0, y: 0, name: id, src: '', kind, mediaId: id, duration: 6 }) as Card;
const project = (): ProjectState =>
  ({
    version: 1,
    title: 't',
    camera: { x: 0, y: 0, zoom: 1 },
    selected: null,
    cards: [card('a'), card('b'), card('ref', 'image')],
    sequence: [],
  }) as ProjectState;

test('a batch either all applies, or leaves the project untouched and names the failing step', () => {
  const before = project();
  expect(() =>
    applyOperations(before, [
      { op: 'set_film', shots: [{ cardId: 'a' }, { cardId: 'b' }] },
      { op: 'link', from: 'ref', to: 'missing' },
    ]),
  ).toThrow('第 2 个操作（link）');
  expect(before.sequence).toEqual([]);

  const { draft, results } = applyOperations(before, [
    { op: 'set_film', shots: [{ cardId: 'a' }, { cardId: 'b', seconds: 4 }] },
    { op: 'add_sound', cardId: 'a', from: 1, length: 2, at: 8, mode: 'replace' },
  ]);
  expect(draft.sequence.map(shot => [shot.cardId, shot.duration])).toEqual([
    ['a', 6],
    ['b', 4],
  ]);
  expect(results[1]).toMatchObject({ op: 'add_sound', soundId: expect.any(String) });
  expect(before.sequence).toEqual([]);
});

test('the version changes with the content, not with the camera', () => {
  const a = project();
  const moved = { ...a, camera: { x: 100, y: 0, zoom: 2 } };
  expect(projectVersion(moved)).toBe(projectVersion(a));
  const { draft } = applyOperations(a, [{ op: 'rename_card', cardId: 'a', name: '耄耋' }]);
  expect(projectVersion(draft)).not.toBe(projectVersion(a));
});
