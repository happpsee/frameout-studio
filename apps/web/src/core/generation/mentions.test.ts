import { expect, test } from 'vitest';
import type { Card } from '../../types';
import { mentionNames, resolveMentions, typedMention } from './mentions';

const card = (id: string, name: string) =>
  ({ id, x: 0, y: 0, name, src: '', kind: 'image' }) as Card;

test('references are named by their line, or their card, and repeats get a number', () => {
  const target = { ...card('t', '结果'), linkNames: { a: '猫脸' } };
  expect(
    mentionNames([card('a', 'cat face'), card('b', '雨 夜'), card('c', '雨夜')], target),
  ).toEqual(['猫脸', '雨夜', '雨夜2']);
});

test('a mention becomes the number of its image in the order sent', () => {
  expect(resolveMentions('@雨夜2 里的猫，换成 @猫脸 的脸，@别人', ['猫脸', '雨夜', '雨夜2'])).toBe(
    '图3 里的猫，换成 图1 的脸，@别人',
  );
});

test('the mention being typed is found right before the caret', () => {
  expect(typedMention('看 @猫', 4)).toEqual({ start: 2, query: '猫' });
  expect(typedMention('看 @猫 走', 6)).toBeNull();
});
