import type { CSSProperties, RefObject } from 'react';
import type { Card } from '../types';
import { usableReference } from '../lib/consistency';
import type { Regeneration } from '../lib/regenerate';
import { jobEnded, pending } from './CanvasCard';
import Icon from './Icon';
import './SelectionActions.css';

interface SelectionActionsProps {
  card: Card;
  /** The card is scrolled out of view; the bar stays mounted but hidden. */
  outside: boolean;
  style: CSSProperties;
  barRef: RefObject<HTMLDivElement | null>;
  /** A generation or a shot plan is running. */
  busy: boolean;
  isReference: boolean;
  /** What "再来一张" would run; null hides it (the card was not generated). */
  regeneration: Regeneration | null;
  onGenerateVideo: () => void;
  onRegenerate: () => void;
  onResume: () => void;
  onToggleReference: () => void;
  onAddShot: () => void;
  onDownload: () => void;
  onRemove: () => void;
}

/** The action bar that floats above the selected card. */
export default function SelectionActions({
  card,
  outside,
  style,
  barRef,
  busy,
  isReference,
  regeneration,
  onGenerateVideo,
  onRegenerate,
  onResume,
  onToggleReference,
  onAddShot,
  onDownload,
  onRemove,
}: SelectionActionsProps) {
  const waiting = pending(card);
  const unavailable = waiting || card.missingMedia;
  return (
    <div
      ref={barRef}
      className={`fo-selection-actions${outside ? ' is-outside' : ''}`}
      style={style}
      aria-hidden={outside}
    >
      <span className="fo-selected-name" title={card.prompt}>
        {card.name}
      </span>
      <button
        type="button"
        className="fo-small-button"
        disabled={busy || card.kind === 'video' || unavailable}
        onClick={onGenerateVideo}
      >
        <Icon name="film" />
        <span>图生视频</span>
      </button>
      {regeneration && (
        <RegenerateButton regeneration={regeneration} busy={busy} onClick={onRegenerate} />
      )}
      {waiting && !jobEnded(card) && (
        <button type="button" className="fo-small-button" disabled={busy} onClick={onResume}>
          <Icon name="clock" />
          <span>继续查询</span>
        </button>
      )}
      {card.kind === 'image' && (
        <button
          type="button"
          className={`fo-small-button fo-reference-toggle${isReference ? ' is-active' : ''}`}
          aria-pressed={isReference}
          disabled={!usableReference(card)}
          onClick={onToggleReference}
        >
          <Icon name="copy" />
          <span>{isReference ? '取消参考' : '设为参考'}</span>
        </button>
      )}
      <button
        type="button"
        className="fo-small-button fo-add-shot"
        disabled={unavailable}
        onClick={onAddShot}
      >
        <Icon name="plus" />
        <span>加入成片</span>
      </button>
      {card.provider && (
        <button
          type="button"
          className="fo-icon-button"
          aria-label="下载生成素材"
          disabled={unavailable}
          onClick={onDownload}
        >
          <Icon name="download" />
        </button>
      )}
      <button
        type="button"
        className="fo-icon-button"
        aria-label="删除选中素材"
        disabled={busy}
        onClick={onRemove}
      >
        <Icon name="trash" />
      </button>
    </div>
  );
}

/** A new paid request with the same prompt; unavailable reasons stay readable on hover and click. */
function RegenerateButton({
  regeneration,
  busy,
  onClick,
}: {
  regeneration: Regeneration;
  busy: boolean;
  onClick: () => void;
}) {
  const label = regeneration.mode === 'video' ? '再来一条' : '再来一张';
  const hint = regeneration.ok
    ? `用同样的提示词${regeneration.source ? '和首帧' : ''}重新生成，会再计费一次`
    : regeneration.reason;
  return (
    <button
      type="button"
      className={`fo-small-button fo-regenerate${regeneration.ok ? '' : ' is-unavailable'}`}
      disabled={busy}
      aria-disabled={!regeneration.ok}
      aria-label={`${label}：${hint}`}
      title={hint}
      onClick={onClick}
    >
      <Icon name="redo" />
      <span>{label}</span>
    </button>
  );
}
