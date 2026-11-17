import type { Card, ProjectState } from '../../types';
import { placeholder, uid } from '../project/project';
import { referenceCards } from '../generation/consistency';

export interface CardLink {
  id: string;
  from: Card;
  to: Card;
  kind: 'reference' | 'first-frame';
}

/** Where each card came from: the references of a generated image, the first frame of a video. */
export function cardLinks(cards: Card[]): CardLink[] {
  const byId = new Map(cards.map(card => [card.id, card]));
  return cards.flatMap(card => {
    const sources: [string, CardLink['kind']][] = [
      ...(card.referenceIds ?? []).map(id => [id, 'reference'] as [string, CardLink['kind']]),
      ...(card.sourceId ? [[card.sourceId, 'first-frame'] as [string, CardLink['kind']]] : []),
    ];
    return sources.flatMap(([id, kind]) => {
      const from = byId.get(id);
      return from && from !== card
        ? [{ id: `${id}>${card.id}:${kind}`, from, to: card, kind }]
        : [];
    });
  });
}

/** The label on a card made by dragging a line into empty canvas, until something is generated. */
export const DRAFT_LABEL = '待生成';
const DRAFT_MEDIA = placeholder('待生成');

/** Makes `from` one of `to`'s references. False when that would be a no-op or a loop. */
export function addReference(draft: Pick<ProjectState, 'cards'>, fromId: string, toId: string) {
  const to = draft.cards.find(card => card.id === toId);
  if (!to || fromId === toId || !draft.cards.some(card => card.id === fromId)) return false;
  if (to.referenceIds?.includes(fromId) || to.sourceId === fromId) return false;
  // A card cannot feed something it was made from.
  const ancestors = new Set<string>();
  const walk = (id: string) => {
    const card = draft.cards.find(item => item.id === id);
    for (const parent of [...(card?.referenceIds ?? []), card?.sourceId ?? ''])
      if (parent && !ancestors.has(parent)) {
        ancestors.add(parent);
        walk(parent);
      }
  };
  walk(fromId);
  if (ancestors.has(toId)) return false;
  to.referenceIds = [...(to.referenceIds ?? []), fromId];
  return true;
}

/** Drops a reference line. First-frame lines stay: they record where a video came from. */
export function removeReference(draft: Pick<ProjectState, 'cards'>, linkId: string) {
  const match = /^(.+)>(.+):reference$/.exec(linkId);
  const to = match && draft.cards.find(card => card.id === match[2]);
  if (!match || !to?.referenceIds) return;
  to.referenceIds = to.referenceIds.filter(id => id !== match[1]);
  if (!to.referenceIds.length) delete to.referenceIds;
  if (to.linkNames) {
    delete to.linkNames[match[1]];
    if (!Object.keys(to.linkNames).length) delete to.linkNames;
  }
}

/** An empty card at `at`, fed by `fromId`, waiting for a prompt. */
export function draftCard(fromId: string, at: { x: number; y: number }): Card {
  return {
    id: uid(),
    x: at.x,
    y: at.y,
    name: DRAFT_LABEL,
    src: DRAFT_MEDIA,
    kind: 'image',
    label: DRAFT_LABEL,
    referenceIds: [fromId],
  };
}

/** Puts a card's references in the order given; the order is the order they are sent in. */
export function reorderReferences(
  draft: Pick<ProjectState, 'cards'>,
  cardId: string,
  ids: string[],
) {
  const card = draft.cards.find(item => item.id === cardId);
  if (!card?.referenceIds) return;
  // Ids not given (also shared as project references, so not shown to reorder) keep their place
  // after the ones that were.
  const kept = ids.filter(id => card.referenceIds?.includes(id));
  card.referenceIds = [...kept, ...card.referenceIds.filter(id => !kept.includes(id))];
}

type Sources = Pick<ProjectState, 'cards' | 'consistency'>;

/**
 * What a card's prompt box sends as reference images, in order: first the project's references
 * (一致性, for every generation), then the cards linked into it, or, for a finished image with
 * nothing linked in, the image itself. A card already among the project's is sent once.
 */
export function sentReferences(card: Card, project: Sources) {
  const byId = new Map(project.cards.map(item => [item.id, item]));
  const global = referenceCards(project);
  const shared = new Set(global.map(item => item.id));
  const linked = (card.referenceIds ?? []).flatMap(id => byId.get(id) ?? []);
  const editable = linked.length > 0 || card.label === DRAFT_LABEL;
  const own = editable ? linked : card.kind === 'image' ? [card] : [];
  return {
    cards: [...global, ...own.filter(item => !shared.has(item.id))],
    /** How many at the front are the project's; they are managed in 一致性, not here. */
    global: global.length,
    editable,
  };
}

const LINK_NAME_MAX = 20;

/**
 * The text on a line: its own name if it has one. A reference line also keeps its number, the
 * same one its thumbnail has in the prompt box.
 */
export function linkLabel(link: CardLink, project: Sources) {
  const name = link.to.linkNames?.[link.from.id];
  if (link.kind === 'first-frame') return name || '首帧';
  const order =
    sentReferences(link.to, project).cards.findIndex(item => item.id === link.from.id) + 1;
  return name ? `${order} · ${name}` : `参考 ${order}`;
}

/** Names a line; an empty name goes back to the default. */
export function renameLink(draft: Pick<ProjectState, 'cards'>, link: CardLink, name: string) {
  const to = draft.cards.find(card => card.id === link.to.id);
  if (!to) return;
  const text = name.trim().slice(0, LINK_NAME_MAX);
  if (text) to.linkNames = { ...to.linkNames, [link.from.id]: text };
  else if (to.linkNames) {
    delete to.linkNames[link.from.id];
    if (!Object.keys(to.linkNames).length) delete to.linkNames;
  }
}
