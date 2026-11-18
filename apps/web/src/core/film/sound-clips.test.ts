import { expect, test } from 'vitest';
import type { Card, SoundClip } from '../../types';
import { clampSound, dragSound, restoreSounds, soundsBetween } from './sound-clips';

const video = { id: 'v', x: 0, y: 0, name: 'v', src: '', kind: 'video', duration: 5 } as Card;
const clip: SoundClip = {
  id: 's',
  cardId: 'v',
  from: 1,
  length: 2,
  at: 8,
  mode: 'replace',
  volume: 1,
};

test('each shot gets the part of a sound clip that falls in it, from the right second', () => {
  // The clip spans film 8–10 s; shot A is 0–9 s, shot B is 9–14 s.
  expect(soundsBetween([clip], 0, 9)).toEqual([{ clip, offset: 8, from: 1, length: 1 }]);
  expect(soundsBetween([clip], 9, 14)).toEqual([{ clip, offset: 0, from: 2, length: 1 }]);
  expect(soundsBetween([clip], 10, 14)).toEqual([]);
});

test('a clip cannot reach past the end of its video', () => {
  expect(clampSound({ ...clip, from: 4, length: 3 }, video)).toMatchObject({ from: 4, length: 1 });
});

test('clips whose video is gone are dropped on load', () => {
  expect(restoreSounds([clip, { ...clip, id: 't', cardId: 'gone' }], [video])).toHaveLength(1);
});

test('pulling the start edge trims the clip but keeps the rest where it was in the film', () => {
  // The clip plays video 1–3 s at film 8–10 s; trimming 0.5 s keeps 1.5–3 s at film 8.5–10 s.
  expect(dragSound(clip, 'start', 0.5)).toMatchObject({ at: 8.5, from: 1.5, length: 1.5 });
  // It cannot reach before the start of its video.
  expect(dragSound(clip, 'start', -3)).toMatchObject({ at: 7, from: 0, length: 3 });
  expect(dragSound(clip, 'move', -20)).toMatchObject({ at: 0, from: 1, length: 2 });
});
