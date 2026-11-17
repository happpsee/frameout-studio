import type { Card } from '../../types';

const MAX_NAME = 12;

/**
 * The name each reference goes by in a prompt ("@猫脸"), in the order they are sent: the line's
 * own name if it has one, otherwise the card's. Spaces and "@" are dropped, and repeats get a
 * number, so every name is one word and points at one image.
 */
export function mentionNames(references: Card[], target: Card) {
  const used = new Map<string, number>();
  return references.map(card => {
    const base =
      (target.linkNames?.[card.id] || card.name || '参考图')
        .replace(/[\s@]+/g, '')
        .slice(0, MAX_NAME) || '参考图';
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    return count === 1 ? base : `${base}${count}`;
  });
}

/**
 * What the model reads: each "@name" becomes "图N", N being that image's place in what is sent,
 * so reordering the references never leaves a prompt pointing at the wrong one. Longer names are
 * tried first, so "@猫脸2" is not read as "@猫脸" followed by "2". Unknown "@words" stay.
 */
export function resolveMentions(text: string, names: string[]) {
  const order = names
    .map((name, index) => ({ name, index }))
    .sort((a, b) => b.name.length - a.name.length);
  let out = '';
  for (let i = 0; i < text.length;) {
    const hit = text[i] === '@' && order.find(({ name }) => text.startsWith(name, i + 1));
    if (hit) {
      out += `图${hit.index + 1}`;
      i += hit.name.length + 1;
    } else out += text[i++];
  }
  return out;
}

/** The "@partial" right before the caret, if the user is typing one. */
export function typedMention(text: string, caret: number) {
  const match = /@([^\s@]*)$/.exec(text.slice(0, caret));
  return match ? { start: match.index, query: match[1] } : null;
}
