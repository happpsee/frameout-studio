import type { Card, ProjectState, Shot, SoundClip } from '../../types';
import { randomId } from '../project/random-id';

/** How long the film plays. */
export const filmLength = (sequence: Shot[]) =>
  sequence.reduce((sum, shot) => sum + shot.duration, 0);

const finite = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** Keeps a sound clip's numbers sensible: inside its video and starting inside the film. */
export function clampSound(clip: SoundClip, source?: Card): SoundClip {
  const clipLength = source?.duration && source.duration > 0 ? source.duration : Infinity;
  const from = Math.min(Math.max(0, finite(clip.from, 0)), Math.max(0, clipLength - 0.1));
  return {
    ...clip,
    from,
    length: Math.min(Math.max(0.1, finite(clip.length, 1)), clipLength - from),
    at: Math.max(0, finite(clip.at, 0)),
    mode: clip.mode === 'replace' ? 'replace' : 'mix',
    volume: Math.min(1, Math.max(0, finite(clip.volume, 1))),
  };
}

/** Takes a video's sound onto the film: all of it, mixed over the film from its start. */
export function addSound(draft: ProjectState, card: Card) {
  if (card.kind !== 'video') return null;
  const clip = clampSound(
    {
      id: `s-${randomId()}`,
      cardId: card.id,
      from: 0,
      length: card.duration ?? 5,
      at: 0,
      mode: 'mix',
      volume: 1,
    },
    card,
  );
  (draft.sounds ??= []).push(clip);
  return clip.id;
}

/** Sound clips that still have their video; the rest are dropped on save and load. */
export function restoreSounds(input: unknown, cards: Card[]): SoundClip[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap(raw => {
    if (!raw || typeof raw.id !== 'string' || typeof raw.cardId !== 'string') return [];
    const source = cards.find(card => card.id === raw.cardId);
    if (!source || source.kind !== 'video') return [];
    const { id, cardId, from, length, at, mode, volume } = raw as SoundClip;
    return [clampSound({ id, cardId, from, length, at, mode, volume }, source)];
  });
}

/**
 * The parts of the sound clips that fall in the film between `start` and `end` seconds:
 * where in that span each lands (`offset`), which second of its video it starts from
 * (`from`), and how long it runs. Used shot by shot when the film is exported.
 */
export function soundsBetween(sounds: SoundClip[], start: number, end: number) {
  return sounds.flatMap(clip => {
    const begin = Math.max(start, clip.at);
    const finish = Math.min(end, clip.at + clip.length);
    if (finish <= begin) return [];
    return [
      { clip, offset: begin - start, from: clip.from + (begin - clip.at), length: finish - begin },
    ];
  });
}

/** What a drag on the sound track does: move the clip, or pull its start or end edge. */
export type SoundDrag = 'move' | 'start' | 'end';

/**
 * The clip after dragging by `delta` seconds from where it was (`start`). Pulling the start
 * edge keeps the sound under the same moment of the film: it trims the beginning of the clip.
 */
export function dragSound(start: SoundClip, kind: SoundDrag, delta: number): SoundClip {
  if (kind === 'move') return { ...start, at: Math.max(0, start.at + delta) };
  if (kind === 'end') return { ...start, length: Math.max(0.1, start.length + delta) };
  const shift = Math.min(Math.max(delta, -start.from, -start.at), start.length - 0.1);
  return {
    ...start,
    at: start.at + shift,
    from: start.from + shift,
    length: start.length - shift,
  };
}
