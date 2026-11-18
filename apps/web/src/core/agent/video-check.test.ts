import { expect, test } from 'vitest';
import { loudness, stillSpans } from './video-check';

test('a stretch where the picture barely changes for a second or more is reported', () => {
  // Quarter-second steps: moving, 1.5 s still, moving, 0.5 s still (too short to report).
  const changes = [5, 6, 2.3, 2.2, 2.4, 2.1, 2.3, 2.2, 7, 2.2, 2.3, 4];
  expect(stillSpans(changes, 0.25)).toEqual([{ from: 0.5, to: 2 }]);
});

test('loudness is given per half second, with samples at full scale counted as clipping', () => {
  const samples = new Float32Array(200).fill(0.1);
  samples.fill(1, 100, 110);
  const result = loudness(samples, 200);
  expect(result.segments).toHaveLength(2);
  expect(result.segments[0]).toBe(-20);
  expect(result.clipped).toBe(10);
});
