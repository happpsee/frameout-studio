import type { Card, Note, ProjectState } from '../../types';
import { visualOrder } from './canvas-selection';

/** One line of the list view: a card, and the videos made from it. */
export type ShotRow = { card: Card; takes: Card[] };
type ShotSection = {
  id: string;
  title: string;
  /** The script this section belongs to; absent for cards made outside any script. */
  note?: Note;
  rows: ShotRow[];
};

const unfinished = (card: Card) =>
  Boolean(card.missingMedia || (card.job && card.job.status !== 'succeeded'));

/** Oldest first when both cards record when they were made; otherwise as read on the canvas. */
function inMakingOrder(cards: Card[]) {
  const visual = visualOrder(cards);
  const place = new Map(visual.map((card, index) => [card.id, index]));
  return [...visual].sort((a, b) =>
    a.generatedAt && b.generatedAt && a.generatedAt !== b.generatedAt
      ? a.generatedAt.localeCompare(b.generatedAt)
      : place.get(a.id)! - place.get(b.id)!,
  );
}

function rows(cards: Card[], all: Card[]): ShotRow[] {
  const ids = new Set(all.map(card => card.id));
  const roots = cards.filter(card => !card.sourceId || !ids.has(card.sourceId));
  return inMakingOrder(roots).map(card => ({
    card,
    takes: inMakingOrder(all.filter(take => take.sourceId === card.id)),
  }));
}

/**
 * The canvas as a list: each script with the shots made from it, then everything else.
 * A video sits in the row of the image it was made from, wherever it is on the canvas.
 */
export function shotSections(project: Pick<ProjectState, 'cards' | 'notes'>): ShotSection[] {
  const scripts = (project.notes ?? [])
    .filter(note => note.kind === 'script')
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const scriptIds = new Set(scripts.map(note => note.id));
  const sections: ShotSection[] = scripts.map(note => ({
    id: note.id,
    title: note.title || '未命名脚本',
    note,
    rows: rows(
      project.cards.filter(card => card.noteId === note.id),
      project.cards,
    ),
  }));
  const loose = project.cards.filter(card => !card.noteId || !scriptIds.has(card.noteId));
  if (loose.length || !sections.length)
    sections.push({
      id: 'loose',
      title: sections.length ? '其他素材' : '全部素材',
      rows: rows(loose, project.cards),
    });
  return sections;
}

/** What "加入成片" adds for a row: its newest finished video, or the card itself. */
export function rowPick(row: ShotRow): Card | undefined {
  return (
    [...row.takes].reverse().find(take => !unfinished(take)) ??
    (unfinished(row.card) ? undefined : row.card)
  );
}
