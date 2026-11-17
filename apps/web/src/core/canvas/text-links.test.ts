import { expect, test } from 'vitest';
import type { Card, Note } from '../../types';
import { addText, linkedTexts, removeText, textLinks, withTexts } from './text-links';

const note = (id: string, text: string) =>
  ({ id, x: 0, y: 0, kind: 'text', title: '', text }) as Note;
const card = (id: string) => ({ id, x: 0, y: 0, name: id, src: '', kind: 'image' }) as Card;

test("a note linked into cards feeds each one's prompt, ahead of what was typed", () => {
  const notes = [note('n', '橘色折耳猫，委屈脸')];
  const draft = { cards: [card('a'), card('b')] };
  expect(addText(draft, 'n', 'a')).toBe(true);
  expect(addText(draft, 'n', 'b')).toBe(true);
  expect(addText(draft, 'n', 'a')).toBe(false);
  expect(textLinks(draft.cards, notes)).toHaveLength(2);
  expect(withTexts('坐在窗台上', linkedTexts(draft.cards[0], notes))).toBe(
    '橘色折耳猫，委屈脸\n\n坐在窗台上',
  );
  removeText(draft, textLinks(draft.cards, notes)[0].id);
  expect(draft.cards[0].textIds).toBeUndefined();
});
