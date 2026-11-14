import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import type { ProjectState, UpdateProject, Workflow } from '../../types';
import type { useGeneration } from './useGeneration';
import { createWorkflow, nextStep, recordEvent } from './workflow';
import { failedImage } from './failed-image';
import { PROVIDER_CAPABILITIES } from '@frameout/shared';

type Options = {
  project: ProjectState;
  projectRef: MutableRefObject<ProjectState>;
  update: UpdateProject;
  generation: ReturnType<typeof useGeneration>;
  flush: () => Promise<void>;
  createCheckpoint: (name: string) => string;
  toast: (message: string) => void;
  openSettings?: (notice: string) => void;
  enabled: boolean;
};

export function useWorkflow(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const executing = useRef(false);
  const starting = useRef(false);
  const owned = useRef(false);
  const mounted = useRef(true);

  const mutate = useCallback((id: string, recipe: (workflow: Workflow) => void) => {
    latest.current.update(draft => {
      if (draft.workflow?.id === id) recipe(draft.workflow);
    }, false);
  }, []);
  const pause = useCallback(() => {
    const { projectRef, generation } = latest.current;
    const workflow = projectRef.current.workflow;
    if (!workflow || workflow.status !== 'running') return;
    mutate(workflow.id, value => {
      value.status = 'paused';
      value.steps.forEach(step => {
        if (step.status === 'running') step.status = 'paused';
      });
      recordEvent(value, '已暂停，完成的镜头与任务号已保留');
    });
    if (owned.current) generation.stop();
  }, [mutate]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!options.enabled) pause();
  }, [options.enabled, pause]);

  /** `from` ties the plan to the script note it was written in and places results beside it. */
  type PlanSource = { noteId: string; origin: { x: number; y: number } };
  const plan = useCallback((text: string, withVideo: boolean, from?: PlanSource) => {
    const { generation, projectRef, update } = latest.current;
    if (generation.active || executing.current || projectRef.current.workflow?.status === 'running')
      throw new Error('请先停止当前生成');
    if (withVideo && !PROVIDER_CAPABILITIES[generation.config.provider].video)
      throw new Error('图生视频计划需要选择支持视频的供应商');
    const workflow = createWorkflow(text, withVideo, generation.config);
    const camera = projectRef.current.camera;
    workflow.origin = from?.origin ?? {
      x: (120 - camera.x) / camera.zoom,
      y: (100 - camera.y) / camera.zoom,
    };
    if (from) workflow.noteId = from.noteId;
    recordEvent(workflow, `已编排 ${workflow.steps.length} 个步骤，等待开始`);
    update(draft => {
      draft.workflow = workflow;
    }, false);
  }, []);
  const start = useCallback(async () => {
    const { generation, projectRef, createCheckpoint, flush, toast, openSettings } = latest.current;
    const workflow = projectRef.current.workflow;
    if (
      !workflow ||
      workflow.status === 'running' ||
      generation.active ||
      executing.current ||
      starting.current
    )
      return;
    if (!generation.config.key) {
      const notice = '镜头计划需要先连接生成服务。';
      if (openSettings) openSettings(notice);
      else toast(notice);
      return;
    }
    if (
      workflow.config.provider !== generation.config.provider ||
      workflow.config.baseUrl.replace(/\/+$/, '') !== generation.config.baseUrl.replace(/\/+$/, '')
    ) {
      toast('请切回计划使用的供应商和 API 地址');
      return;
    }
    if (!nextStep(workflow)) {
      toast('请先处理需要重新生成的步骤，或重新编排计划');
      return;
    }
    starting.current = true;
    try {
      const checkpointId = workflow.checkpointId || createCheckpoint('工作流开始前');
      mutate(workflow.id, value => {
        value.checkpointId = checkpointId;
      });
      await flush();
      if (!mounted.current || !latest.current.enabled) return;
      mutate(workflow.id, value => {
        value.status = 'running';
        recordEvent(value, '开始执行镜头计划');
      });
    } catch {
      toast('计划保存失败，请检查存储后重试');
    } finally {
      starting.current = false;
    }
  }, [mutate]);

  const retry = useCallback(
    (stepId: string) => {
      const { projectRef, update } = latest.current;
      const workflow = projectRef.current.workflow;
      if (!workflow || workflow.status === 'running' || executing.current) return;
      // The new attempt goes where the failed image was, so the failed card makes way.
      const output = workflow.steps.find(item => item.id === stepId)?.outputCardId;
      const failed = projectRef.current.cards.find(card => card.id === output);
      if (failedImage(failed))
        update(draft => {
          draft.cards = draft.cards.filter(card => card.id !== failed.id);
          if (draft.selected === failed.id) draft.selected = null;
        }, false);
      mutate(workflow.id, value => {
        const step = value.steps.find(item => item.id === stepId);
        if (!step || step.status === 'succeeded') return;
        // A known provider job must be queried, never silently submitted again.
        const card = latest.current.projectRef.current.cards.find(
          item => item.id === step.outputCardId,
        );
        if (card?.job?.id && !['failed', 'cancelled'].includes(card.job.status))
          step.status = 'paused';
        else {
          step.status = 'queued';
          delete step.outputCardId;
        }
        delete step.error;
        value.status = 'paused';
        recordEvent(value, '已由用户确认重试此步骤', step.id);
      });
    },
    [mutate],
  );

  useEffect(() => {
    const workflow = options.project.workflow;
    if (
      !options.enabled ||
      !workflow ||
      workflow.status !== 'running' ||
      executing.current ||
      options.generation.active
    )
      return;
    const step = nextStep(workflow);
    if (!step) {
      mutate(workflow.id, value => {
        value.status = value.steps.every(item => item.status === 'succeeded')
          ? 'completed'
          : 'paused';
        recordEvent(
          value,
          value.status === 'completed' ? '镜头计划已完成' : '计划等待处理失败或中断的步骤',
        );
      });
      return;
    }
    executing.current = true;
    owned.current = true;
    const workflowId = workflow.id;
    const existing = options.project.cards.find(card => card.id === step.outputCardId);
    const parent = workflow.steps.find(item => item.id === step.dependsOn);
    const source = parent && options.project.cards.find(card => card.id === parent.outputCardId);
    const imageIndex = workflow.steps
      .filter(item => item.mode === 'image')
      .findIndex(item => item.id === step.id);
    const columnWidth = workflow.steps.some(item => item.mode === 'video') ? 640 : 320;
    mutate(workflowId, value => {
      const current = value.steps.find(item => item.id === step.id)!;
      current.status = 'running';
      delete current.error;
      recordEvent(
        value,
        `开始${step.mode === 'image' ? '生成图片' : existing ? '查询原视频任务' : '生成视频'}`,
        step.id,
      );
    });
    void (async () => {
      let error = '';
      try {
        // Persist the claimed step before starting a request that can be billed.
        await latest.current.flush();
        if (!mounted.current || latest.current.projectRef.current.workflow?.status !== 'running')
          return;
        if (step.outputCardId && !existing)
          throw new Error('之前的结果素材已不可用，请核对供应商后确认是否重新生成');
        if (existing && step.mode === 'image') {
          if (failedImage(existing)) throw new Error(existing.job.error || '图片生成失败');
          if (existing.missingMedia) throw new Error('结果素材无法读取，请先恢复素材');
        } else if (existing?.job?.status === 'succeeded') {
          // Completion can be persisted before the scheduler records its result.
        } else if (existing && step.mode === 'video') {
          if (!existing.job?.id)
            throw new Error('未取得任务号，请先到供应商核对，再决定是否重新生成');
          await latest.current.generation.resume(existing);
        } else {
          if (step.dependsOn && (!source || source.missingMedia || source.kind !== 'image'))
            throw new Error('首帧素材不可用，请恢复素材后重试');
          await latest.current.generation.generate(source || undefined, {
            prompt: step.prompt,
            mode: step.mode,
            config: { ...workflow.config, key: latest.current.generation.config.key },
            position: {
              x: (workflow.origin?.x || 0) + (imageIndex % 2) * columnWidth,
              y: (workflow.origin?.y || 0) + Math.floor(imageIndex / 2) * 280,
            },
            onCard: id =>
              latest.current.update(draft => {
                if (draft.workflow?.id !== workflowId) return;
                const current = draft.workflow.steps.find(item => item.id === step.id);
                if (current) current.outputCardId = id;
                const card = draft.cards.find(item => item.id === id);
                if (card && draft.workflow.noteId) card.noteId = draft.workflow.noteId;
              }, false),
          });
        }
      } catch (caught) {
        error = caught instanceof Error ? caught.message : '步骤执行失败';
      } finally {
        executing.current = false;
        owned.current = false;
        if (mounted.current) {
          mutate(workflowId, value => {
            const current = value.steps.find(item => item.id === step.id);
            if (!current) return;
            const card = latest.current.projectRef.current.cards.find(
              item => item.id === current.outputCardId,
            );
            const success =
              !error &&
              card &&
              !card.missingMedia &&
              (!card.job || card.job.status === 'succeeded');
            if (success) {
              current.status = 'succeeded';
              delete current.error;
              recordEvent(value, '步骤完成，结果已加入画布', step.id);
            } else {
              // A failed image is on the canvas with its reason; the step waits for a retry.
              current.status = failedImage(card) ? 'failed' : 'paused';
              current.error = error || card?.job?.error || '步骤已中断，请核对供应商后重试';
              value.status = 'paused';
              recordEvent(value, current.error, step.id);
            }
          });
        }
      }
    })();
  }, [options.project, options.enabled, options.generation.active, mutate]);

  return {
    plan,
    start,
    pause,
    retry,
    running: options.project.workflow?.status === 'running',
    settling: executing.current,
  };
}
