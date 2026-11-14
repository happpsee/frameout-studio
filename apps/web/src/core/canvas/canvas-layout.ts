import type { Card, Note, ProjectState } from '../../types';
import { CARD_HEIGHT, CARD_WIDTH } from './canvas-camera';
import { visualOrder } from './canvas-selection';
import { NOTE_HEIGHT, NOTE_WIDTH } from './notes';

export type ArrangeMode = 'grid' | 'row' | 'column';
type Point = { x: number; y: number };
const GAP = 30;
const STEP_X = CARD_WIDTH + GAP;
const STEP_Y = CARD_HEIGHT + GAP;
/** Columns of results beside a script, and of cards that belong to no script. */
const SECTION_COLUMNS = 4;

const gridColumns = (count: number, mode: ArrangeMode) =>
  mode === 'row' ? count : mode === 'column' ? 1 : Math.ceil(Math.sqrt(count));

function place(cards: Card[], origin: Point, columns: number) {
  const positions = new Map<string, Point>();
  cards.forEach((card, index) =>
    positions.set(card.id, {
      x: origin.x + (index % columns) * STEP_X,
      y: origin.y + Math.floor(index / columns) * STEP_Y,
    }),
  );
  return positions;
}

/**
 * New positions for a set of cards: a grid, one row or one column, in reading order,
 * starting from the top-left corner the set already occupies.
 */
export function arrange(cards: Card[], mode: ArrangeMode) {
  if (!cards.length) return new Map<string, Point>();
  const origin = {
    x: Math.min(...cards.map(card => card.x)),
    y: Math.min(...cards.map(card => card.y)),
  };
  return place(visualOrder(cards), origin, gridColumns(cards.length, mode));
}

/** Each card followed by the videos made from it, so a first frame and its takes stay together. */
function withTakes(cards: Card[]) {
  const ids = new Set(cards.map(card => card.id));
  const roots = cards.filter(card => !card.sourceId || !ids.has(card.sourceId));
  return visualOrder(roots).flatMap(root => [
    root,
    ...visualOrder(cards.filter(card => card.sourceId === root.id)),
  ]);
}

/**
 * Tidies the whole canvas: every script with its results in a block to its right, then text
 * notes and the cards that belong to no script. Starts where the content already starts.
 */
export function tidy(project: Pick<ProjectState, 'cards' | 'notes'>) {
  const notes = project.notes ?? [];
  const cards = new Map<string, Point>();
  const placedNotes = new Map<string, Point>();
  const everything: Point[] = [...project.cards, ...notes];
  if (!everything.length) return { cards, notes: placedNotes };
  const left = Math.min(...everything.map(item => item.x));
  let top = Math.min(...everything.map(item => item.y));
  const byPosition = (a: Note, b: Note) => a.y - b.y || a.x - b.x;
  const cardLeft = left + (notes.length ? NOTE_WIDTH + GAP * 2 : 0);
  const section = (note: Note | undefined, members: Card[]) => {
    if (note) placedNotes.set(note.id, { x: left, y: top });
    place(withTakes(members), { x: cardLeft, y: top }, SECTION_COLUMNS).forEach((point, id) =>
      cards.set(id, point),
    );
    const rows = Math.ceil(members.length / SECTION_COLUMNS);
    top += Math.max(note ? NOTE_HEIGHT + GAP : 0, rows * STEP_Y) + GAP;
  };
  const scripts = notes.filter(note => note.kind === 'script').sort(byPosition);
  const scriptIds = new Set(scripts.map(note => note.id));
  for (const script of scripts)
    section(
      script,
      project.cards.filter(card => card.noteId === script.id),
    );
  const loose = project.cards.filter(card => !card.noteId || !scriptIds.has(card.noteId));
  const texts = notes.filter(note => note.kind === 'text').sort(byPosition);
  const looseTop = top;
  texts.forEach((note, index) =>
    placedNotes.set(note.id, { x: left, y: looseTop + index * (NOTE_HEIGHT + GAP) }),
  );
  section(undefined, loose);
  return { cards, notes: placedNotes };
}
