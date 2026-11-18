import { useState } from 'react';
import type { ProjectState, SoundClip, UpdateProject } from '../../types';
import Icon from '../../ui/Icon';
import { clampSound, filmLength } from './sound-clips';
import './SoundLane.css';

const round = (value: number) => Math.round(value * 10) / 10;

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
  let edge = 0;
  return (
    <div className="fo-sound-lane">
      <div className="fo-sound-head">
        <span>音频</span>
        {!sounds.length && <small>选中视频卡片，点「取声音」把它的声音放到这里</small>}
      </div>
      <div className="fo-sound-track" aria-label="音频轨">
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
              style={{ left: percent(clip.at), width: percent(clip.length) }}
              title={`${card?.name ?? '声音'} · ${clip.mode === 'replace' ? '替换原声' : '叠加'}`}
              onClick={() => setPicked(clip.id === picked ? null : clip.id)}
            >
              {card?.name ?? '声音'}
            </button>
          );
        })}
      </div>
      {current && (
        <div className="fo-sound-editor" aria-label="声音设置">
          <label>
            放在成片第
            <input
              type="number"
              min={0}
              step={0.1}
              value={round(current.at)}
              onChange={event => change(current.id, { at: Number(event.target.value) })}
            />
            秒
          </label>
          <label>
            取素材第
            <input
              type="number"
              min={0}
              step={0.1}
              value={round(current.from)}
              onChange={event => change(current.id, { from: Number(event.target.value) })}
            />
            秒起
          </label>
          <label>
            长
            <input
              type="number"
              min={0.1}
              step={0.1}
              value={round(current.length)}
              onChange={event => change(current.id, { length: Number(event.target.value) })}
            />
            秒
          </label>
          <div className="fo-sound-mode" role="group" aria-label="和原声的关系">
            {(['replace', 'mix'] as const).map(mode => (
              <button
                key={mode}
                type="button"
                aria-pressed={current.mode === mode}
                onClick={() => change(current.id, { mode })}
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
              value={Math.round(current.volume * 100)}
              onChange={event => change(current.id, { volume: Number(event.target.value) / 100 })}
            />
            {Math.round(current.volume * 100)}%
          </label>
          <button
            type="button"
            className="fo-tiny-button"
            aria-label="删除这段声音"
            title="删除这段声音"
            onClick={() => {
              update(draft => {
                draft.sounds = draft.sounds?.filter(clip => clip.id !== current.id);
              });
              setPicked(null);
            }}
          >
            <Icon name="trash" />
          </button>
        </div>
      )}
    </div>
  );
}
