import { useEffect, useRef, useState } from 'react';
import type { ProjectState, StepStatus } from '../../types';
import type { useWorkflow } from './useWorkflow';
import { workspaceDiff } from './workflow';
import { referenceCards } from './consistency';
import PlanToSequence from './PlanToSequence';

type Props = {
  tab: 'workflow' | 'versions';
  onTab: (tab: 'workflow' | 'versions') => void;
  onClose: () => void;
  project: ProjectState;
  workflow: ReturnType<typeof useWorkflow>;
  busy: boolean;
  createCheckpoint: (name: string) => string;
  restoreCheckpoint: (id: string) => void;
  toast: (message: string) => void;
  selectCard: (id: string) => void;
  /** Appends cards to the sequence in order, as one undo step. */
  addToSequence: (ids: string[]) => void;
};
const statusNames: Record<StepStatus, string> = {
  queued: '等待',
  running: '进行中',
  paused: '待处理',
  failed: '失败',
  succeeded: '完成',
  cancelled: '已取消',
};

export default function WorkflowPanel({
  tab,
  onTab,
  onClose,
  project,
  workflow,
  busy,
  createCheckpoint,
  restoreCheckpoint,
  toast,
  selectCard,
  addToSequence,
}: Props) {
  const [text, setText] = useState('');
  const referenceCount = referenceCards(project).length;
  const continuity = [
    project.consistency?.notes ? '统一设定' : '',
    referenceCount ? `${referenceCount} 张参考图` : '',
  ]
    .filter(Boolean)
    .join('和');
  const [withVideo, setWithVideo] = useState(false);
  const [name, setName] = useState('');
  const [retrying, setRetrying] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const run = project.workflow;
  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  const attempt = (action: () => void) => {
    try {
      action();
    } catch (error) {
      toast(error instanceof Error ? error.message : '操作失败');
    }
  };

  return (
    <aside
      className="fo-work-panel"
      aria-label="创作流程"
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="fo-work-panel-head">
        <div>
          <span className="fo-eyebrow">按计划生成</span>
          <h2>把镜头一步步做出来</h2>
        </div>
        <button ref={closeRef} type="button" aria-label="关闭创作流程" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="fo-work-tabs" role="tablist" aria-label="创作流程视图">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'workflow'}
          onClick={() => onTab('workflow')}
        >
          镜头计划
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'versions'}
          onClick={() => onTab('versions')}
        >
          版本记录 <span>{project.checkpoints?.length || 0}</span>
        </button>
      </div>
      <div
        className="fo-work-panel-body"
        role="tabpanel"
        aria-label={tab === 'workflow' ? '镜头计划' : '版本记录'}
      >
        {tab === 'workflow' ? (
          <>
            <form
              className="fo-plan-form"
              onSubmit={event => {
                event.preventDefault();
                attempt(() => workflow.plan(text, withVideo));
              }}
            >
              <label htmlFor="fo-plan-prompts">每一行，描述一个镜头</label>
              <textarea
                id="fo-plan-prompts"
                value={text}
                onChange={event => setText(event.target.value)}
                rows={4}
                maxLength={32008}
                placeholder={'清晨，森林里一位探险者走向光线\n镜头拉近，树叶上的露水缓缓滑落'}
                disabled={busy}
              />
              <label className="fo-plan-check">
                <input
                  type="checkbox"
                  checked={withVideo}
                  onChange={event => setWithVideo(event.target.checked)}
                  disabled={busy}
                />
                图片完成后，接着生成视频
              </label>
              <button type="submit" className="fo-plan-preview" disabled={busy || !text.trim()}>
                预览计划
              </button>
              <p className="fo-work-note">
                最多 8 个镜头。先检查步骤，再开始调用已配置的生成服务。
              </p>
              {continuity && (
                <p className="fo-work-note fo-plan-continuity">
                  每个镜头都会使用{continuity}，可在输入框上方的「一致性」里修改。
                </p>
              )}
            </form>
            {run && (
              <section className="fo-run" aria-label="当前镜头计划">
                <div className="fo-run-heading">
                  <h3>
                    {run.status === 'completed'
                      ? '镜头已就绪'
                      : run.status === 'running'
                        ? '正在制作镜头'
                        : '待执行的镜头计划'}
                  </h3>
                  <span>
                    {run.steps.filter(step => step.status === 'succeeded').length} /{' '}
                    {run.steps.length}
                  </span>
                </div>
                <ol className="fo-run-steps">
                  {run.steps.map((step, index) => {
                    const card = project.cards.find(item => item.id === step.outputCardId);
                    const canQuery = Boolean(
                      card?.job?.id && !['failed', 'cancelled'].includes(card.job.status),
                    );
                    return (
                      <li key={step.id} data-status={step.status}>
                        <div className="fo-step-number">
                          {step.status === 'succeeded' ? '✓' : String(index + 1).padStart(2, '0')}
                        </div>
                        <div className="fo-step-content">
                          <div className="fo-step-heading">
                            <strong>{step.mode === 'image' ? '生成图片' : '首帧生成视频'}</strong>
                            <span>{statusNames[step.status]}</span>
                          </div>
                          <p>{step.prompt}</p>
                          {step.dependsOn && (
                            <small>
                              等待步骤{' '}
                              {run.steps.findIndex(parent => parent.id === step.dependsOn) + 1}{' '}
                              的图片完成
                            </small>
                          )}
                          {step.error && <p className="fo-step-error">{step.error}</p>}
                          {card && (
                            <button
                              type="button"
                              className="fo-inline-button"
                              onClick={() => selectCard(card.id)}
                            >
                              查看画布素材 ↗
                            </button>
                          )}
                          {['paused', 'failed', 'cancelled'].includes(step.status) && !busy && (
                            <>
                              {canQuery ? (
                                <span className="fo-work-note">开始计划后将继续查询原任务</span>
                              ) : (
                                <button
                                  type="button"
                                  className="fo-inline-button"
                                  onClick={() => setRetrying(step.id)}
                                >
                                  重新生成此步骤
                                </button>
                              )}
                              {retrying === step.id && (
                                <div className="fo-work-confirm">
                                  <p>
                                    请先核对供应商的提交记录。重新生成会发起新请求，可能再次计费。
                                  </p>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      workflow.retry(step.id);
                                      setRetrying(null);
                                    }}
                                  >
                                    确认重新生成
                                  </button>
                                  <button type="button" onClick={() => setRetrying(null)}>
                                    返回
                                  </button>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
                <PlanToSequence run={run} project={project} onAdd={addToSequence} toast={toast} />
                {workflow.running ? (
                  <button type="button" className="fo-plan-start" onClick={workflow.pause}>
                    暂停计划
                  </button>
                ) : (
                  <button
                    type="button"
                    className="fo-plan-start"
                    disabled={busy || run.status === 'completed'}
                    onClick={() => {
                      void workflow.start();
                    }}
                  >
                    {run.status === 'completed'
                      ? '镜头已全部完成'
                      : run.status === 'draft'
                        ? '保存版本并开始生成'
                        : '继续未完成的计划'}
                  </button>
                )}
                <p className="fo-work-note">
                  暂停会停止本页等待，已提交的任务仍可能在供应商执行。刷新后由你手动继续。
                </p>
                <details className="fo-run-events">
                  <summary>
                    执行记录 <span>{run.events.length}</span>
                  </summary>
                  <ol>
                    {run.events
                      .slice()
                      .reverse()
                      .map(event => (
                        <li key={event.id}>
                          <time>
                            {new Date(event.at).toLocaleTimeString('zh-CN', { hour12: false })}
                          </time>
                          <span>
                            {event.stepId
                              ? `步骤 ${run.steps.findIndex(step => step.id === event.stepId) + 1} · `
                              : ''}
                            {event.message}
                          </span>
                        </li>
                      ))}
                  </ol>
                </details>
              </section>
            )}
          </>
        ) : (
          <>
            <form
              className="fo-version-form"
              onSubmit={event => {
                event.preventDefault();
                attempt(() => {
                  createCheckpoint(name);
                  setName('');
                  toast('版本已保留');
                });
              }}
            >
              <label htmlFor="fo-version-name">保留当前的编排</label>
              <div>
                <input
                  id="fo-version-name"
                  value={name}
                  maxLength={80}
                  onChange={event => setName(event.target.value)}
                  placeholder="例如 雨夜版第一稿"
                />
                <button type="submit" disabled={busy}>
                  保存版本
                </button>
              </div>
            </form>
            <p className="fo-work-note">
              保留最近 8 个版本，包含素材位置、镜头顺序和时长。生成计划开始前会自动保存一次。
            </p>
            {!project.checkpoints?.length && (
              <div className="fo-version-empty">
                给现在的想法留个位置。
                <br />
                之后可以回来比较和调整。
              </div>
            )}
            {project.checkpoints
              ?.slice()
              .reverse()
              .map(checkpoint => {
                const diff = workspaceDiff(project, checkpoint.state);
                return (
                  <article key={checkpoint.id} className="fo-version">
                    <div>
                      <h3>{checkpoint.name}</h3>
                      <time>{new Date(checkpoint.createdAt).toLocaleString('zh-CN')}</time>
                    </div>
                    <p>
                      当前比此版本新增 {diff.added} 个素材，移除 {diff.removed} 个，修改{' '}
                      {diff.changed} 个{diff.sequenceChanged ? '，镜头编排有变化' : ''}。
                    </p>
                    <button
                      type="button"
                      className="fo-inline-button"
                      disabled={busy}
                      onClick={() => setRestoring(checkpoint.id)}
                    >
                      回到这个版本
                    </button>
                    {restoring === checkpoint.id && (
                      <div className="fo-work-confirm">
                        <p>恢复画布和镜头编排前，会自动备份当前版本。生成计划将暂停。</p>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            attempt(() => {
                              restoreCheckpoint(checkpoint.id);
                              setRestoring(null);
                              toast('已恢复版本，当前编排也已备份');
                            })
                          }
                        >
                          确认恢复
                        </button>
                        <button type="button" onClick={() => setRestoring(null)}>
                          返回
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
          </>
        )}
      </div>
    </aside>
  );
}
