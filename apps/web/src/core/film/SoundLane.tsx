import { useRef, useState, type PointerEvent } from 'react';
import type { ProjectState, SoundClip, UpdateProject } from '../../types';
import Icon from '../../ui/Icon';
import { clampSound, dragSound, filmLength, type SoundDrag } from './sound-clips';
import './SoundLane.css';

const round = (value: number) => Math.round(value * 10) / 10;
/** Within this many pixels of a block's edge, a drag trims instead of moving. */
const EDGE = 8;

/**
 * The film's sound track, drawn to scale under the shots: each block is sound taken from a
 * video, placed at a second of the film. Picking a block opens its numbers.
 */
export default function SoundLane({
  project,
  update,
}: {
  project: ProjectState;
  update: UpdateProject;
}) {
  const sounds = project.sounds ?? [];
  const [picked, setPicked] = useState<string | null>(null);
  const film = filmLength(project.sequence);
  const total = Math.max(film, ...sounds.map(clip => clip.at + clip.length), 1);
  const percent = (seconds: number) => `${(seconds / total) * 100}%`;
  const current = sounds.find(clip => clip.id === picked);
  const change = (id: string, patch: Partial<SoundClip>) =>
    update(draft => {
      const index = draft.sounds?.findIndex(clip => clip.id === id) ?? -1;
      if (index < 0) return;
      const clip = draft.sounds![index];
      const source = draft.cards.find(card => card.id === clip.cardId);
      draft.sounds![index] = clampSound({ ...clip, ...patch }, source);
    });
  const track = useRef<HTMLDivElement>(null);
  /** The drag in progress: what is pulled, from where, and the clip as it was. */
  const drag = useRef<{ kind: SoundDrag; x: number; clip: SoundClip; moved: boolean } | null>(null);
  const startDrag = (event: PointerEvent<HTMLButtonElement>, clip: SoundClip) => {
    const box = event.currentTarget.getBoundingClientRect();
    const kind: SoundDrag =
      event.clientX - box.left < EDGE ? 'start' : box.right - event.clientX < EDGE ? 'end' : 'move';
    drag.current = { kind, x: event.clientX, clip, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: PointerEvent<HTMLButtonElement>, last: boolean) => {
    const current = drag.current;
    const width = track.current?.clientWidth;
    if (!current || !width) return;
    const pixels = event.clientX - current.x;
    if (Math.abs(pixels) > 2) current.moved = true;
    if (!current.moved) return;
    const next = dragSound(current.clip, current.kind, (pixels / width) * total);
    // Only the drop is one undo step; the moves on the way are not recorded.
    update(draft => {
      const index = draft.sounds?.findIndex(clip => clip.id === current.clip.id) ?? -1;
      if (index < 0) return;
      const source = draft.cards.find(card => card.id === current.clip.cardId);
      draft.sounds![index] = clampSound(next, source);
    }, last);
  };
  let edge = 0;
  return (
    <div className="fo-sound-lane">
      <div className="fo-sound-head">
        <span>音频</span>
        {!sounds.length && <small>选中视频卡片，点「取声音」把它的声音放到这里</small>}
      </div>
      <div className="fo-sound-track" aria-label="音频轨" ref={track}>
        {project.sequence.map(shot => {
          edge += shot.duration;
          return <span key={shot.id} className="fo-sound-cut" style={{ left: percent(edge) }} />;
        })}
        {sounds.map(clip => {
          const card = project.cards.find(item => item.id === clip.cardId);
          return (
            <button
              key={clip.id}
              type="button"
              className={`fo-sound-clip is-${clip.mode}${clip.id === picked ? ' is-picked' : ''}`}
              style={{
                left: percent(clip.at),
                width: percent(clip.length),
                // Shorter clips sit on top, so one under a long clip can still be grabbed.
                zIndex: Math.round(1000 - (clip.length / total) * 999),
              }}
              title={`${card?.name ?? '声音'} · ${clip.mode === 'replace' ? '替换原声' : '叠加'}`}
              onPointerDown={event => startDrag(event, clip)}
              onPointerMove={event => moveDrag(event, false)}
              onPointerUp={event => {
                const moved = drag.current?.moved;
                moveDrag(event, true);
                drag.current = null;
                if (!moved) setPicked(clip.id === picked ? null : clip.id);
              }}
              onPointerCancel={() => {
                drag.current = null;
              }}
            >
              {card?.name ?? '声音'}
            </button>
          );
        })}
      </div>
      {current && (
        <SoundEditor
          clip={current}
          onChange={patch => change(current.id, patch)}
          onRemove={() => {
            update(draft => {
              draft.sounds = draft.sounds?.filter(clip => clip.id !== current.id);
            });
            setPicked(null);
          }}
        />
      )}
    </div>
  );
}

/** The numbers of one sound clip, for exact placing. */
function SoundEditor({
  clip,
  onChange,
  onRemove,
}: {
  clip: SoundClip;
  onChange: (patch: Partial<SoundClip>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="fo-sound-editor" aria-label="声音设置">
      <label>
        放在成片第
        <input
          type="number"
          min={0}
          step={0.1}
          value={round(clip.at)}
          onChange={event => onChange({ at: Number(event.target.value) })}
        />
        秒
      </label>
      <label>
        取素材第
        <input
          type="number"
          min={0}
          step={0.1}
          value={round(clip.from)}
          onChange={event => onChange({ from: Number(event.target.value) })}
        />
        秒起
      </label>
      <label>
        长
        <input
          type="number"
          min={0.1}
          step={0.1}
          value={round(clip.length)}
          onChange={event => onChange({ length: Number(event.target.value) })}
        />
        秒
      </label>
      <div className="fo-sound-mode" role="group" aria-label="和原声的关系">
        {(['replace', 'mix'] as const).map(mode => (
          <button
            key={mode}
            type="button"
            aria-pressed={clip.mode === mode}
            onClick={() => onChange({ mode })}
          >
            {mode === 'replace' ? '替换原声' : '叠加'}
          </button>
        ))}
      </div>
      <label>
        音量
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={Math.round(clip.volume * 100)}
          onChange={event => onChange({ volume: Number(event.target.value) / 100 })}
        />
        {Math.round(clip.volume * 100)}%
      </label>
      <button
        type="button"
        className="fo-tiny-button"
        aria-label="删除这段声音"
        title="删除这段声音"
        onClick={onRemove}
      >
        <Icon name="trash" />
      </button>
    </div>
  );
}
