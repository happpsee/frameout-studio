import type { Card, Note, ProjectState } from '../../types';
import { draftCard } from './card-links';

/** A line from a text or script note into a card: the note's words become part of its prompt. */
export interface TextLink {
  id: string;
  note: Note;
  card: Card;
}

/** Id of a note's node on the canvas; cards use their own ids. */
export const noteNodeId = (id: string) => `note:${id}`;

export function textLinks(cards: Card[], notes: Note[]): TextLink[] {
  const byId = new Map(notes.map(note => [note.id, note]));
  return cards.flatMap(card =>
    (card.textIds ?? []).flatMap(id => {
      const note = byId.get(id);
      return note ? [{ id: `${noteNodeId(id)}>${card.id}:text`, note, card }] : [];
    }),
  );
}

/** Feeds a note's words into a card. False when it already does. */
export function addText(draft: Pick<ProjectState, 'cards'>, noteId: string, cardId: string) {
  const card = draft.cards.find(item => item.id === cardId);
  if (!card || card.textIds?.includes(noteId)) return false;
  card.textIds = [...(card.textIds ?? []), noteId];
  return true;
}

export function removeText(draft: Pick<ProjectState, 'cards'>, linkId: string) {
  const match = /^note:(.+)>(.+):text$/.exec(linkId);
  const card = match && draft.cards.find(item => item.id === match[2]);
  if (!match || !card?.textIds) return;
  card.textIds = card.textIds.filter(id => id !== match[1]);
  if (!card.textIds.length) delete card.textIds;
}

/** An empty card at `at`, its prompt coming from the note. */
export function textDraft(noteId: string, at: { x: number; y: number }): Card {
  const { referenceIds: _none, ...card } = draftCard('', at);
  return { ...card, textIds: [noteId] };
}

/** The notes wired into a card, in the order they were linked. */
export const linkedTexts = (card: Card, notes: Note[] = []) =>
  (card.textIds ?? []).flatMap(id => notes.find(note => note.id === id) ?? []);

/** The linked notes' words first, then what was typed in the card's own box. */
export function withTexts(prompt: string, texts: Note[]) {
  return [...texts.map(note => note.text.trim()), prompt.trim()].filter(Boolean).join('\n\n');
}
