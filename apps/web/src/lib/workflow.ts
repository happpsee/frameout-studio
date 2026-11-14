import type { AIConfig, Workflow, WorkflowStep, WorkspaceSnapshot } from '../types';
import { scriptShots } from './notes';
import { preferenceOnly, uid } from './project';

export function createWorkflow(text: string, withVideo: boolean, config: AIConfig): Workflow {
  const prompts = scriptShots(text);
  if (!prompts.length || prompts.length > 8) throw new Error('请输入 1 到 8 个镜头，每行一个');
  const steps: WorkflowStep[] = [];
  for (const prompt of prompts) {
    if (prompt.length > 4000) throw new Error('每个镜头描述最多 4000 字');
    const image: WorkflowStep = { id: uid(), prompt, mode: 'image', status: 'queued' };
    steps.push(image);
    if (withVideo)
      steps.push({ id: uid(), prompt, mode: 'video', status: 'queued', dependsOn: image.id });
  }
  return {
    id: uid(),
    createdAt: Date.now(),
    status: 'draft',
    steps,
    events: [],
    config: preferenceOnly(config),
  };
}

export function recordEvent(workflow: Workflow, message: string, stepId?: string) {
  workflow.events.push({ id: uid(), at: Date.now(), message, stepId });
  workflow.events = workflow.events.slice(-160);
}

export function nextStep(workflow: Workflow): WorkflowStep | undefined {
  return workflow.steps.find(step => {
    const ready =
      step.status === 'queued' || (step.status === 'paused' && Boolean(step.outputCardId));
    return (
      ready &&
      (!step.dependsOn ||
        workflow.steps.some(
          parent => parent.id === step.dependsOn && parent.status === 'succeeded',
        ))
    );
  });
}

export function restoreWorkflow(input: Workflow | undefined, recover = true): Workflow | undefined {
  if (!input || typeof input.id !== 'string' || !Array.isArray(input.steps)) return;
  const ids = new Set<string>();
  const statuses = new Set(['queued', 'running', 'paused', 'failed', 'succeeded', 'cancelled']);
  const steps = input.steps
    .slice(0, 16)
    .filter(step => {
      if (
        !step ||
        typeof step.id !== 'string' ||
        ids.has(step.id) ||
        typeof step.prompt !== 'string' ||
        !['image', 'video'].includes(step.mode)
      )
        return false;
      ids.add(step.id);
      return true;
    })
    .map(step => ({
      id: step.id,
      prompt: step.prompt.slice(0, 4000),
      mode: step.mode,
      status: (recover && step.status === 'running'
        ? 'paused'
        : statuses.has(step.status)
          ? step.status
          : 'paused') as WorkflowStep['status'],
      dependsOn: typeof step.dependsOn === 'string' ? step.dependsOn : undefined,
      outputCardId: typeof step.outputCardId === 'string' ? step.outputCardId : undefined,
      error: typeof step.error === 'string' ? step.error.slice(0, 600) : undefined,
    }));
  // Dependencies must point backwards. This rejects cycles and missing parents.
  const seen = new Set<string>();
  for (const step of steps) {
    if (step.dependsOn && !seen.has(step.dependsOn)) {
      step.status = 'failed';
      step.error = '依赖步骤不可用，请重新编排计划';
    }
    seen.add(step.id);
  }
  return {
    id: input.id,
    createdAt: Number(input.createdAt) || Date.now(),
    checkpointId: typeof input.checkpointId === 'string' ? input.checkpointId : undefined,
    origin:
      input.origin && Number.isFinite(input.origin.x) && Number.isFinite(input.origin.y)
        ? { x: input.origin.x, y: input.origin.y }
        : { x: 0, y: 0 },
    noteId: typeof input.noteId === 'string' ? input.noteId : undefined,
    status:
      input.status === 'draft' || input.status === 'completed'
        ? input.status
        : !recover && input.status === 'running'
          ? 'running'
          : 'paused',
    steps,
    config: preferenceOnly(input.config || {}),
    events: Array.isArray(input.events)
      ? input.events
          .slice(-160)
          .filter(event => event && typeof event.message === 'string')
          .map(event => ({
            id: String(event.id),
            at: Number(event.at) || 0,
            message: event.message.slice(0, 600),
            stepId: typeof event.stepId === 'string' ? event.stepId : undefined,
          }))
      : [],
  };
}

export function workspaceDiff(current: WorkspaceSnapshot, previous: WorkspaceSnapshot) {
  const before = new Map(previous.cards.map(card => [card.id, card]));
  const after = new Map(current.cards.map(card => [card.id, card]));
  const changed = current.cards.filter(card => {
    const old = before.get(card.id);
    if (!old) return false;
    // A restored blob URL changes between sessions while the media stays the same.
    const comparable = (value: typeof card) => ({
      ...value,
      src: value.mediaId ? '' : value.src,
      missingMedia: undefined,
    });
    return JSON.stringify(comparable(old)) !== JSON.stringify(comparable(card));
  });
  return {
    added: current.cards.filter(card => !before.has(card.id)).length,
    removed: previous.cards.filter(card => !after.has(card.id)).length,
    changed: changed.length,
    sequenceChanged: JSON.stringify(current.sequence) !== JSON.stringify(previous.sequence),
  };
}
