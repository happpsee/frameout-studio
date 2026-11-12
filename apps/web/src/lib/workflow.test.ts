import { describe, expect, it } from 'vitest';
import { createWorkflow, nextStep, restoreWorkflow, workspaceDiff } from './workflow';
import { defaults } from './preferences';
import { initialState, restoreProject, serializeProject } from './project';

describe('shot plans and checkpoint persistence', () => {
  it('only schedules a video after its image dependency has succeeded', () => {
    const workflow = createWorkflow('森林远景\n雨滴特写', true, {
      ...defaults('ark'),
      key: 'not-for-storage',
    });
    expect(workflow.steps).toHaveLength(4);
    expect(workflow.config).not.toHaveProperty('key');
    expect(nextStep(workflow)).toBe(workflow.steps[0]);
    workflow.steps[0].status = 'paused';
    expect(nextStep(workflow)).toBe(workflow.steps[2]);
    workflow.steps[0].status = 'succeeded';
    expect(nextStep(workflow)).toBe(workflow.steps[1]);
  });
  it('restores interrupted work as paused while preserving completed results', () => {
    const workflow = createWorkflow('森林远景', true, {
      ...defaults('ark'),
      key: 'not-for-storage',
    });
    workflow.status = 'running';
    workflow.steps[0].status = 'succeeded';
    workflow.steps[0].outputCardId = 'image';
    workflow.steps[1].status = 'running';
    workflow.steps[1].outputCardId = 'video';
    const project = { ...initialState(), workflow };
    const serialized = serializeProject(project);
    expect(serialized.workflow?.status).toBe('running');
    const recovered = restoreProject(serialized).workflow!;
    expect(recovered.status).toBe('paused');
    expect(recovered.steps.map(step => step.status)).toEqual(['succeeded', 'paused']);
    expect(recovered.steps[1].outputCardId).toBe('video');
    expect(JSON.stringify(serialized)).not.toContain('not-for-storage');
  });
  it('rejects a cyclic dependency and limits the number of planned calls', () => {
    const workflow = createWorkflow('第一帧', false, { ...defaults('ark'), key: '' });
    workflow.steps[0].dependsOn = workflow.steps[0].id;
    expect(restoreWorkflow(workflow)?.steps[0].status).toBe('failed');
    expect(() =>
      createWorkflow(Array(9).fill('镜头').join('\n'), false, { ...defaults('ark'), key: '' }),
    ).toThrow();
  });
  it('serializes checkpoint media references and excludes credentials and nested history', () => {
    const state = initialState();
    state.cards = [
      {
        id: 'frame',
        name: '首帧',
        kind: 'image',
        x: 20,
        y: 40,
        src: 'blob:old-session',
        mediaId: 'stored-frame',
      },
    ];
    const project = { ...state, checkpoints: [{ id: 'v1', name: '第一稿', createdAt: 1, state }] };
    const serialized = serializeProject(project);
    expect(serialized.checkpoints![0].state.cards[0].src).toBe('');
    expect(serialized.checkpoints![0].state).not.toHaveProperty('checkpoints');
    const restored = restoreProject(serialized);
    expect(restored.checkpoints![0].state.cards[0].missingMedia).toBe(true);
    expect(workspaceDiff(restored, restored.checkpoints![0].state).changed).toBe(0);
  });
});
