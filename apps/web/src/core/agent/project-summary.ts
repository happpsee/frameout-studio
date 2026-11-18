import type { Card, ProjectState } from '../../types';
import { cardLinks, linkLabel } from '../canvas/card-links';
import { textLinks } from '../canvas/text-links';
import { filmLength } from '../film/sound-clips';
import { estimateCost, projectCost } from '../generation/pricing';

const short = (text: string | undefined, length = 160) =>
  text && text.length > length ? `${text.slice(0, length)}…` : text;

function cardSummary(card: Card) {
  return {
    id: card.id,
    name: card.name,
    kind: card.kind,
    label: card.label,
    position: { x: Math.round(card.x), y: Math.round(card.y) },
    ...(card.duration ? { seconds: Math.round(card.duration * 100) / 100 } : {}),
    ...(card.size || card.ratio ? { size: card.size ?? card.ratio } : {}),
    ...(card.prompt ? { prompt: short(card.prompt) } : {}),
    ...(card.job
      ? { status: card.job.status, ...(card.job.error ? { error: card.job.error } : {}) }
      : {}),
    ...(card.missingMedia ? { missingMedia: true } : {}),
    ...(estimateCost(card) !== null ? { costYuan: estimateCost(card) } : {}),
  };
}

/**
 * What an agent sees of the open project: cards, the lines between them, notes, the film and
 * its sound track, and what has been spent. Ids are what the other tools take.
 */
export function projectSummary(project: ProjectState) {
  const { cards } = project;
  return {
    title: project.title,
    cards: cards.map(cardSummary),
    lines: [
      ...cardLinks(cards).map(link => ({
        from: link.from.id,
        to: link.to.id,
        kind: link.kind,
        label: linkLabel(link, project),
      })),
      ...textLinks(cards, project.notes ?? []).map(link => ({
        from: `note:${link.note.id}`,
        to: link.card.id,
        kind: 'text',
      })),
    ],
    notes: (project.notes ?? []).map(note => ({
      id: note.id,
      kind: note.kind,
      title: note.title,
      text: short(note.text, 2000),
    })),
    consistency: project.consistency ?? { notes: '', references: [] },
    film: {
      seconds: Math.round(filmLength(project.sequence) * 100) / 100,
      shots: project.sequence.map((shot, index) => ({
        number: index + 1,
        id: shot.id,
        cardId: shot.cardId,
        seconds: shot.duration,
      })),
      sounds: project.sounds ?? [],
    },
    spentYuan: projectCost(cards),
  };
}
