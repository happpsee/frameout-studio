import type { Card, Shot, Workflow } from '../types';

const finished = (card?: Card): card is Card =>
  Boolean(card && !card.missingMedia && (!card.job || card.job.status === 'succeeded'));

/**
 * The finished final result of each shot, in plan order: the video when the plan made one
 * from the shot's image, otherwise the image. Shots whose final result is unfinished, failed
 * or deleted are left out.
 */
export function planResults(workflow: Workflow, cards: Card[]): Card[] {
  const byId = new Map(cards.map(card => [card.id, card]));
  const results: Card[] = [];
  for (const image of workflow.steps.filter(step => step.mode === 'image')) {
    const video = workflow.steps.find(step => step.mode === 'video' && step.dependsOn === image.id);
    const card = byId.get((video ?? image).outputCardId ?? '');
    if (finished(card) && !results.includes(card)) results.push(card);
  }
  return results;
}

/** What "全部加入成片" adds: finished results not yet in the sequence, and how many shots it skips. */
export function planShotsToAdd(workflow: Workflow, cards: Card[], sequence: Shot[]) {
  const inSequence = new Set(sequence.map(shot => shot.cardId));
  const results = planResults(workflow, cards);
  const ids = results.filter(card => !inSequence.has(card.id)).map(card => card.id);
  const shots = workflow.steps.filter(step => step.mode === 'image').length;
  return { results: results.length, ids, skipped: shots - ids.length };
}
