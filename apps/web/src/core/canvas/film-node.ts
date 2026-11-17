import type { Card, ProjectState, Shot, WorkspaceSnapshot } from '../../types';
import { CARD_HEIGHT } from './canvas-camera';
import { STEP_X } from './canvas-layout';

/**
 * The film is a card on the canvas too. It is drawn from the sequence: each shot is a line from
 * its video into the film card, numbered by its place, so the list below and the lines are one
 * and the same. Only where the film card sits is stored.
 */
export const FILM_ID = 'film';
export const FILM_WIDTH = 220;
export const FILM_HEIGHT = 170;
const EDGE_PREFIX = 'film:';

export const filmEdgeId = (shot: Shot) => `${EDGE_PREFIX}${shot.id}`;

/** Where the film card is: where it was put, or to the right of everything else. */
export function filmPosition(project: Pick<WorkspaceSnapshot, 'film' | 'cards'>) {
  if (project.film) return project.film;
  if (!project.cards.length) return { x: 0, y: 0 };
  const right = Math.max(...project.cards.map(card => card.x));
  const top = Math.min(...project.cards.map(card => card.y));
  const bottom = Math.max(...project.cards.map(card => card.y));
  return { x: right + STEP_X, y: (top + bottom + CARD_HEIGHT - FILM_HEIGHT) / 2 };
}

/** The lines into the film card, in the order the film plays them. */
export function filmLinks(sequence: Shot[], cards: Card[]) {
  return sequence.flatMap((shot, index) =>
    cards.some(card => card.id === shot.cardId)
      ? [{ id: filmEdgeId(shot), from: shot.cardId, label: `镜头 ${index + 1}` }]
      : [],
  );
}

/** Deleting a film line takes that shot out of the film. True when the id was a film line. */
export function removeShot(draft: ProjectState, edgeId: string) {
  if (!edgeId.startsWith(EDGE_PREFIX)) return false;
  const id = edgeId.slice(EDGE_PREFIX.length);
  draft.sequence = draft.sequence.filter(shot => shot.id !== id);
  return true;
}
