import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Note, StepStatus, Workflow } from '../types';
import { SCRIPT_SHOT_MAX, scriptProgress, scriptShots } from '../lib/notes';
import Icon from '../ui/Icon';
import './CanvasNote.css';

const shotStatus: Record<StepStatus, string> = {
  queued: '等待',
  running: '生成中',
  paused: '待处理',
  failed: '失败',
  succeeded: '完成',
  cancelled: '已取消',
};

type Props = {
  note: Note;
  zoom: number;
  selected: boolean;
  /** A card made from this script is selected. */
  linked: boolean;
  /** The project's shot plan; it may belong to another script. */
  workflow?: Workflow;
  /** A generation is running somewhere in the project. */
  busy: boolean;
  /** How many canvas cards were made from this script. */
  results: number;
  onSelect: (id: string) => void;
  /** `record` false keeps the change out of the undo history. */
  onChange: (
    id: string,
    patch: Partial<Pick<Note, 'title' | 'text' | 'kind'>>,
    record?: boolean,
  ) => void;
  onMove: (id: string, x: number, y: number) => void;
  onRemove: (id: string) => void;
  onUsePrompt: (text: string) => void;
  onPlan: (id: string, withVideo: boolean) => void;
  onStart: () => void;
  onPause: () => void;
  onSelectCard: (id: string) => void;
};

/** A text or script note on the canvas. Dragged by its header; the body is always editable. */
export function CanvasNote(props: Props) {
  const { note, zoom, selected, workflow } = props;
  const [offset, setOffset] = useState<{ dx: number; dy: number } | null>(null);
  const drag = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  // One undo step per stretch of typing: only the first change after focusing is recorded.
  const typed = useRef(false);
  const type = (patch: Partial<Pick<Note, 'title' | 'text'>>) => {
    props.onChange(note.id, patch, !typed.current);
    typed.current = true;
  };
  const script = note.kind === 'script';
  const shots = script ? scriptShots(note.text) : [];
  const progress = script ? scriptProgress(note.id, workflow) : undefined;
  // Editing the script after planning leaves the plan describing the old lines.
  const stale =
    Boolean(progress) &&
    workflow?.steps
      .filter(step => step.mode === 'image')
      .map(step => step.prompt)
      .join('\n') !== shots.join('\n');
  const planned = Boolean(progress) && !stale;
  const running = planned && workflow?.status === 'running';
  const done = progress?.filter(shot => shot.status === 'succeeded').length ?? 0;

  function startDrag(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0 || (event.target as Element).closest('input,button')) return;
    drag.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveDrag(event: ReactPointerEvent<HTMLElement>) {
    const start = drag.current;
    if (start?.pointerId !== event.pointerId) return;
    setOffset({ dx: (event.clientX - start.x) / zoom, dy: (event.clientY - start.y) / zoom });
  }
  function endDrag(event: ReactPointerEvent<HTMLElement>, commit: boolean) {
    const start = drag.current;
    if (start?.pointerId !== event.pointerId) return;
    drag.current = null;
    // Read the pointer, not the offset state: a fast drag can end before the last frame renders.
    const dx = (event.clientX - start.x) / zoom;
    const dy = (event.clientY - start.y) / zoom;
    if (commit && Math.abs(dx) + Math.abs(dy) > 1) props.onMove(note.id, note.x + dx, note.y + dy);
    setOffset(null);
  }

  return (
    <article
      data-note={note.id}
      className={`fo-note is-${note.kind}${selected ? ' is-selected' : ''}${props.linked ? ' is-linked' : ''}${offset ? ' is-dragging' : ''}`}
      style={{ left: note.x + (offset?.dx ?? 0), top: note.y + (offset?.dy ?? 0) }}
      onPointerDownCapture={() => props.onSelect(note.id)}
    >
      <header
        className="fo-note-top"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={event => endDrag(event, true)}
        onPointerCancel={event => endDrag(event, false)}
      >
        <Icon name={script ? 'list' : 'text'} />
        <input
          value={note.title}
          aria-label={script ? '脚本名称' : '文本名称'}
          maxLength={40}
          // Only as wide as the name, so the rest of the header stays free for dragging.
          style={{ width: `calc(${Math.max(3, note.title.length)}em + 12px)` }}
          onFocus={() => (typed.current = false)}
          onChange={event => type({ title: event.target.value })}
        />
        <span>{script ? `${shots.length} 个镜头` : '文本'}</span>
      </header>
      <textarea
        value={note.text}
        aria-label={script ? '脚本内容，每行一个镜头' : '文本内容'}
        rows={Math.min(14, Math.max(4, note.text.split('\n').length + 1))}
        placeholder={
          script
            ? '每一行，描述一个镜头\n清晨，森林里一位探险者走向光线\n镜头拉近，树叶上的露水缓缓滑落'
            : '写下剧本、文案或备忘'
        }
        disabled={running}
        onFocus={() => (typed.current = false)}
        onChange={event => type({ text: event.target.value })}
      />
      {progress && (
        <ol className="fo-note-shots" aria-label="镜头进度">
          {progress.map((shot, index) => (
            <li key={index} data-status={shot.status}>
              <button
                type="button"
                title={`镜头 ${index + 1} · ${shotStatus[shot.status]}`}
                aria-label={`镜头 ${index + 1}，${shotStatus[shot.status]}`}
                disabled={!shot.cardId}
                onClick={() => shot.cardId && props.onSelectCard(shot.cardId)}
              >
                {index + 1}
              </button>
            </li>
          ))}
          <li className="fo-note-count">
            {done} / {progress.length}
          </li>
        </ol>
      )}
      {selected && (
        <NoteActions
          {...props}
          shots={shots.length}
          planned={planned}
          replan={Boolean(progress)}
          running={Boolean(running)}
        />
      )}
      {selected && script && shots.length > SCRIPT_SHOT_MAX && (
        <p className="fo-note-hint">一次最多编排 {SCRIPT_SHOT_MAX} 个镜头，请拆成两份脚本。</p>
      )}
      {selected && script && !planned && props.results > 0 && (
        <p className="fo-note-hint">画布上有 {props.results} 个素材来自这份脚本，已高亮。</p>
      )}
    </article>
  );
}

/** What the selected note can do: plan and run a script, or reuse a text. */
function NoteActions(
  props: Props & { shots: number; planned: boolean; running: boolean; replan: boolean },
) {
  const { note, workflow, busy, shots, planned, running } = props;
  const [withVideo, setWithVideo] = useState(false);
  const script = note.kind === 'script';
  return (
    <footer className="fo-note-actions">
      {script ? (
        running ? (
          <button type="button" className="fo-note-primary" onClick={props.onPause}>
            暂停
          </button>
        ) : planned && workflow?.status !== 'completed' ? (
          <button type="button" className="fo-note-primary" disabled={busy} onClick={props.onStart}>
            开始生成
          </button>
        ) : (
          <>
            <button
              type="button"
              className="fo-note-primary"
              disabled={busy || !shots || shots > SCRIPT_SHOT_MAX}
              onClick={() => props.onPlan(note.id, withVideo)}
            >
              {props.replan ? '重新编排' : '编排分镜'}
            </button>
            <label>
              <input
                type="checkbox"
                checked={withVideo}
                onChange={event => setWithVideo(event.target.checked)}
              />
              接着生成视频
            </label>
          </>
        )
      ) : (
        <>
          <button
            type="button"
            className="fo-note-primary"
            disabled={!note.text.trim()}
            onClick={() => props.onUsePrompt(note.text.trim())}
          >
            用作提示词
          </button>
          <button
            type="button"
            disabled={!note.text.trim()}
            title="每一行变成一个镜头"
            onClick={() => props.onChange(note.id, { kind: 'script' })}
          >
            转成脚本
          </button>
        </>
      )}
      <button
        type="button"
        className="fo-note-remove"
        aria-label={script ? '删除脚本' : '删除文本'}
        title="删除"
        onClick={() => props.onRemove(note.id)}
      >
        <Icon name="trash" />
      </button>
    </footer>
  );
}
