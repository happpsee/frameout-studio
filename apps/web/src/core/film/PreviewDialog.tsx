import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Card, SoundClip } from '../../types';
import Icon from '../../ui/Icon';
import { timeLabel } from './Sequence';
import { closeOnBackdropClick } from '../../ui/dialog';
import PromptCopy from './PromptCopy';
import PreviewSoundButton from './PreviewSoundButton';
import { loadPreviewMuted, playPreviewClip, savePreviewMuted } from './preview-sound';
import { usePreviewSounds } from './usePreviewSounds';

export type PreviewItem = { card: Card; duration: number };
export default function PreviewDialog({
  items,
  title,
  sounds = [],
  onClose,
}: {
  items: PreviewItem[];
  title: string;
  /** The film's sound track; empty when previewing one card. */
  sounds?: { clip: SoundClip; card: Card }[];
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const total = items.reduce((sum, item) => sum + item.duration, 0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(true);
  // Video clips play with their own sound unless muted; images are silent.
  const [muted, setMuted] = useState(loadPreviewMuted);
  let offset = 0;
  let index = 0;
  for (let i = 0; i < items.length; i++) {
    index = i;
    if (time < offset + items[i].duration || i === items.length - 1) break;
    offset += items[i].duration;
  }
  const current = items[index];
  const card = current.card;
  const prompt = (card.prompt || card.job?.prompt || '').trim();
  const timeRef = useRef(time);
  timeRef.current = time;
  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);
  useEffect(() => {
    if (!playing) {
      video.current?.pause();
      return;
    }
    let frame = 0;
    let previous = 0;
    const tick = (now: number) => {
      if (previous) {
        const next = Math.min(total, timeRef.current + Math.min(0.1, (now - previous) / 1000));
        timeRef.current = next;
        setTime(next);
        if (next >= total) {
          setPlaying(false);
          return;
        }
      }
      previous = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    if (video.current) playPreviewClip(video.current, () => setMuted(true));
    return () => cancelAnimationFrame(frame);
  }, [playing, total]);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const seek = () => {
      const local = Math.max(0, timeRef.current - offset);
      element.currentTime = Number.isFinite(element.duration)
        ? Math.min(local, Math.max(0, element.duration - 0.01))
        : local;
      if (playing) playPreviewClip(element, () => setMuted(true));
      else element.pause();
    };
    if (element.readyState >= 1) seek();
    else element.addEventListener('loadedmetadata', seek, { once: true });
    return () => element.removeEventListener('loadedmetadata', seek);
  }, [card.id, playing, offset]);
  // A sound clip that replaces the shots' own sound silences the shot while it plays.
  const replaced = usePreviewSounds(sounds, time, playing, muted);
  useEffect(() => {
    if (video.current) video.current.muted = muted || replaced;
  }, [muted, replaced, card.id]);
  function seek(value: number) {
    timeRef.current = value;
    setTime(value);
    const element = video.current;
    if (element && value >= offset && value < offset + current.duration)
      element.currentTime = Number.isFinite(element.duration)
        ? Math.min(value - offset, Math.max(0, element.duration - 0.01))
        : value - offset;
  }
  function skip(direction: number) {
    const target = Math.min(items.length - 1, Math.max(0, index + direction));
    seek(items.slice(0, target).reduce((sum, item) => sum + item.duration, 0));
  }
  return (
    <dialog
      ref={dialog}
      className="fo-preview-dialog"
      aria-labelledby="fo-preview-heading"
      onCancel={onClose}
      onClose={onClose}
      onClick={closeOnBackdropClick(onClose)}
    >
      <div className="fo-preview-head">
        <div>
          <span className="fo-eyebrow">预览</span>
          <h2 className="fo-preview-title" id="fo-preview-heading">
            {title}
          </h2>
        </div>
        <button type="button" className="fo-icon-button" aria-label="关闭预览" onClick={onClose}>
          <Icon name="x" />
        </button>
      </div>
      <div
        className={`fo-preview-screen tone-${card.tone ?? 'normal'}${!playing ? ' is-paused' : ''}`}
      >
        {card.kind === 'video' ? (
          <video
            key={card.id}
            ref={video}
            src={card.src}
            poster={card.poster}
            muted={muted || replaced}
            playsInline
            preload="auto"
            style={{ objectPosition: card.crop, objectFit: card.provider ? 'contain' : 'cover' }}
          />
        ) : (
          <img
            key={card.id}
            src={card.src}
            alt={card.name}
            style={{ objectPosition: card.crop, objectFit: card.provider ? 'contain' : 'cover' }}
          />
        )}
      </div>
      <div className="fo-preview-description">
        <span className="fo-preview-shot">
          {String(index + 1).padStart(2, '0')} / {String(items.length).padStart(2, '0')} ·{' '}
          {card.name}
        </span>
        <span>顺序预览</span>
      </div>
      {prompt && <PromptCopy key={card.id} prompt={prompt} />}
      <div className="fo-preview-controls">
        <button
          type="button"
          className="fo-icon-button"
          aria-label="上一个镜头"
          disabled={!index}
          onClick={() => skip(-1)}
        >
          <Icon name="chevron-left" />
        </button>
        <button
          type="button"
          className="fo-preview-play"
          aria-label={playing ? '暂停预览' : '播放预览'}
          onClick={() => {
            if (time >= total) seek(0);
            setPlaying(value => !value);
          }}
        >
          <Icon name={playing ? 'pause' : 'play'} />
        </button>
        <button
          type="button"
          className="fo-icon-button"
          aria-label="下一个镜头"
          disabled={index === items.length - 1}
          onClick={() => skip(1)}
        >
          <Icon name="chevron-right" />
        </button>
        <input
          className="fo-preview-progress"
          type="range"
          min="0"
          max={total}
          value={time}
          step="0.01"
          aria-label="预览播放位置"
          onChange={event => seek(Number(event.target.value))}
          style={{ '--progress': `${(time / total) * 100}%` } as CSSProperties}
        />
        <span className="fo-preview-time">
          {timeLabel(time)} / {timeLabel(total)}
        </span>
        <PreviewSoundButton
          muted={muted}
          onToggle={() => {
            setMuted(!muted);
            savePreviewMuted(!muted);
          }}
        />
      </div>
    </dialog>
  );
}
