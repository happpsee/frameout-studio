import type { ProjectState, Workflow } from '../types';
import { planShotsToAdd } from '../lib/plan-results';
import './PlanToSequence.css';

/** "全部加入成片": appends a shot plan's finished results to the sequence in plan order. */
export default function PlanToSequence({
  run,
  project,
  onAdd,
  toast,
}: {
  run: Workflow;
  project: ProjectState;
  /** Adds the ids in order as one undo step. */
  onAdd: (ids: string[]) => void;
  toast: (message: string) => void;
}) {
  const { results, ids, skipped } = planShotsToAdd(run, project.cards, project.sequence);
  if (!results) return null;
  return (
    <button
      type="button"
      className="fo-plan-sequence"
      disabled={!ids.length}
      title={ids.length ? undefined : '计划里做好的镜头都已在成片里'}
      onClick={() => {
        onAdd(ids);
        // Replaces the generic "已加入成片" notice with the count for the whole plan.
        toast(
          `已加入成片 ${ids.length} 个镜头${skipped ? `，${skipped} 个未完成或已在成片里` : ''} · 在下方拖动调整顺序`,
        );
      }}
    >
      {ids.length ? `全部加入成片（${ids.length}）` : '已全部加入成片'}
    </button>
  );
}
