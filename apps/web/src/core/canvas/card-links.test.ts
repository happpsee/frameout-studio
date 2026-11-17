import { expect, test } from 'vitest';
import type { Card, ProjectState } from '../../types';
import {
  addReference,
  cardLinks,
  draftCard,
  linkLabel,
  removeReference,
  renameLink,
  reorderReferences,
  sentReferences,
} from './card-links';
import { placeImageCard } from '../generation/failed-image';

const card = (id: string, extra: Partial<Card> = {}) => ({ id, x: 0, y: 0, ...extra }) as Card;

test('an image links to its references and a video to its first frame; deleted sources are skipped', () => {
  const links = cardLinks([
    card('body'),
    card('face'),
    card('sheet', { referenceIds: ['body', 'face', 'gone'] }),
    card('clip', { sourceId: 'sheet' }),
  ]);
  expect(links.map(link => `${link.from.id}>${link.to.id}:${link.kind}`)).toEqual([
    'body>sheet:reference',
    'face>sheet:reference',
    'sheet>clip:first-frame',
  ]);
});

test('a line adds a reference once, and never makes a loop', () => {
  const draft = { cards: [card('a'), card('b', { referenceIds: ['a'] }), card('c')] };
  expect(addReference(draft, 'a', 'c')).toBe(true);
  expect(addReference(draft, 'a', 'c')).toBe(false);
  expect(addReference(draft, 'b', 'a')).toBe(false);
  expect(draft.cards[2].referenceIds).toEqual(['a']);
  removeReference(draft, 'a>c:reference');
  expect(draft.cards[2].referenceIds).toBeUndefined();
});

test('a generated image takes the place of the draft card it was made in', () => {
  const draft = draftCard('a', { x: 40, y: 50 });
  const project = { cards: [card('a'), draft] } as unknown as ProjectState;
  placeImageCard(project, card('result', { kind: 'image', referenceIds: ['a'] }), draft.id);
  expect(project.cards.map(item => item.id)).toEqual(['a', 'result']);
  expect(project.cards[1]).toMatchObject({ x: 40, y: 50 });
});

test('references are sent in the order they are arranged', () => {
  const target = card('t', { kind: 'image', referenceIds: ['a', 'b', 'c'] });
  const draft = { cards: [card('a'), card('b'), card('c'), target] };
  reorderReferences(draft, 't', ['c', 'a', 'b']);
  expect(sentReferences(target, draft).cards.map(item => item.id)).toEqual(['c', 'a', 'b']);
  reorderReferences(draft, 't', ['b', 'x']);
  expect(target.referenceIds).toEqual(['b', 'c', 'a']);
});

test('a named line shows its name, keeps its number, and loses the name when unlinked', () => {
  const draft = { cards: [card('a'), card('b', { referenceIds: ['a'] })] };
  const [link] = cardLinks(draft.cards);
  renameLink(draft, link, '  猫脸 ');
  const [named] = cardLinks(draft.cards);
  expect(linkLabel(named, draft)).toBe('1 · 猫脸');
  renameLink(draft, named, '');
  expect(linkLabel(cardLinks(draft.cards)[0], draft)).toBe('参考 1');
  renameLink(draft, named, '猫脸');
  removeReference(draft, named.id);
  expect(draft.cards[1].linkNames).toBeUndefined();
});

test("the project's references go first and are numbered before the linked ones", () => {
  const image = (id: string, extra: Partial<Card> = {}) => card(id, { kind: 'image', ...extra });
  const target = image('t', { referenceIds: ['a', 'g'] });
  const project = {
    cards: [image('g'), image('a'), target],
    consistency: { notes: '', references: ['g'] },
  };
  const sent = sentReferences(target, project);
  expect(sent.cards.map(item => item.id)).toEqual(['g', 'a']);
  expect(sent.global).toBe(1);
  const toA = cardLinks(project.cards).find(link => link.from.id === 'a')!;
  expect(linkLabel(toA, project)).toBe('参考 2');
});
