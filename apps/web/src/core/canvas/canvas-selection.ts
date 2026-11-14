import type { Card, ProjectState } from '../../types';
import { CARD_HEIGHT, CARD_WIDTH } from './canvas-camera';

type Point = { x: number; y: number };
export type Rect = { left: number; top: number; width: number; height: number };

/** The rectangle spanned by two corner points, whichever way the drag went. */
export function rectBetween(a: Point, b: Point): Rect {
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/** Ids of the cards that touch a rectangle given in canvas (world) units. */
export function cardsInRect(cards: Card[], rect: Rect) {
  return cards
    .filter(
      card =>
        card.x + CARD_WIDTH >= rect.left &&
        card.x <= rect.left + rect.width &&
        card.y + CARD_HEIGHT >= rect.top &&
        card.y <= rect.top + rect.height,
    )
    .map(card => card.id);
}

/**
 * Cards in the order a person reads the canvas: left to right, and top to bottom
 * within a column. Cards less than half a card apart horizontally share a column.
 */
export function visualOrder(cards: Card[]) {
  const byX = [...cards].sort((a, b) => a.x - b.x || a.y - b.y);
  const columns: Card[][] = [];
  for (const card of byX) {
    const column = columns.at(-1);
    if (column && card.x - column[0].x < CARD_WIDTH / 2) column.push(card);
    else columns.push([card]);
  }
  return columns.flatMap(column => column.sort((a, b) => a.y - b.y || a.x - b.x));
}

/** Removes cards and everything that points at them: shots, references and the selection. */
export function removeCards(draft: ProjectState, ids: string[]) {
  const gone = new Set(ids);
  draft.cards = draft.cards.filter(card => !gone.has(card.id));
  draft.sequence = draft.sequence.filter(shot => !gone.has(shot.cardId));
  if (draft.selected && gone.has(draft.selected)) draft.selected = null;
  if (draft.consistency)
    draft.consistency.references = draft.consistency.references.filter(ref => !gone.has(ref));
}
