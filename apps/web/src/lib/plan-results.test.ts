import { describe, expect, it } from 'vitest';
import { planResults, planShotsToAdd } from './plan-results';
import { createWorkflow } from './workflow';
import { defaults } from './preferences';
import { preferenceOnly } from './project';
import { failedImageCard } from './failed-image';
import type { Card } from '../types';

const image = (id: string): Card => ({ id, x: 0, y: 0, name: id, kind: 'image', src: 'blob:x' });
const video = (id: string, status: string): Card => ({
  ...image(id),
  kind: status === 'succeeded' ? 'video' : 'image',
  job: { id: 't', provider: 'ark', status, prompt: 'p', config: preferenceOnly(defaults('ark')) },
});

function plan(withVideo: boolean, outputs: (string | undefined)[]) {
  const workflow = createWorkflow('一\n二\n三', withVideo, defaults('ark'));
  workflow.steps.forEach((step, index) => {
    if (outputs[index]) step.outputCardId = outputs[index];
  });
  return workflow;
}

describe('plan results for the sequence', () => {
  it('takes images in plan order, skipping failed, unfinished and deleted ones', () => {
    const failed = {
      ...failedImageCard('二', '失败', defaults('ark'), { x: 0, y: 0 }),
      id: 'b',
    };
    const workflow = plan(false, ['a', 'b', 'gone']);
    expect(planResults(workflow, [failed, image('a')]).map(card => card.id)).toEqual(['a']);
  });

  it('prefers each shot’s video over its image, and leaves shots whose video is not done', () => {
    // Steps: image 1, video 1, image 2, video 2, image 3, video 3.
    const workflow = plan(true, ['i1', 'v1', 'i2', 'v2', 'i3', undefined]);
    const cards = [
      image('i1'),
      image('i2'),
      image('i3'),
      video('v1', 'succeeded'),
      video('v2', 'running'),
    ];
    expect(planResults(workflow, cards).map(card => card.id)).toEqual(['v1']);
  });

  it('skips results already in the sequence and counts what it skips', () => {
    const workflow = plan(false, ['a', 'b', 'c']);
    const cards = [image('c'), image('b'), image('a')];
    const result = planShotsToAdd(workflow, cards, [{ id: 's', cardId: 'b', duration: 4 }]);
    expect(result).toEqual({ results: 3, ids: ['a', 'c'], skipped: 1 });
  });
});
