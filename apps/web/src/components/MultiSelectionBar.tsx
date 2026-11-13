import { useEffect, useRef } from 'react';
import type { Card } from '../types';
import type { MultiSelection } from '../hooks/useMultiSelection';
import type { Rect } from '../lib/canvas-selection';
import { visualOrder } from '../lib/canvas-selection';
import { pending } from './CanvasCard';
import Icon from './Icon';
import './MultiSelectionBar.css';

interface MultiSelectionBarProps {
  selection: MultiSelection;
  cards: Card[];
  /** The studio is on screen; keys are ignored otherwise. */
  enabled: boolean;
  /** A generation or a shot plan is running, so cards cannot be removed. */
  busy: boolean;
  toast: (message: string) => void;
  onAddShots: (ids: string[]) => void;
}

const ignoredTargets =
  '.fo-work-panel,input,textarea,select,[role="combobox"],[role="listbox"],[contenteditable="true"]';

/** Actions for two or more selected cards: add them to the cut, delete them, or deselect. */
export default function MultiSelectionBar({
  selection,
  cards,
  enabled,
  busy,
  toast,
  onAddShots,
}: MultiSelectionBarProps) {
  const count = selection.ids.length;
  const chosen = cards.filter(card => selection.ids.includes(card.id));
  const ready = visualOrder(chosen).filter(card => !card.missingMedia && !pending(card));
  const remove = () => {
    if (busy) toast('先停止本页等待，再删除素材');
    else selection.remove();
  };
  const removeRef = useRef(remove);
  removeRef.current = remove;

  useEffect(() => {
    if (!enabled || count < 2) return;
    const keydown = (event: KeyboardEvent) => {
      if (!['Delete', 'Backspace'].includes(event.key)) return;
      if ((event.target as Element)?.closest?.(ignoredTargets)) return;
      if (document.querySelector('dialog[open]')) return;
      event.preventDefault();
      removeRef.current();
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [enabled, count]);

  if (count < 2) return null;
  return (
    <div className="fo-selection-actions fo-multi-selection" role="toolbar" aria-label="多选操作">
      <span className="fo-selected-name">已选 {count} 个</span>
      <button
        type="button"
        className="fo-small-button fo-add-shot"
        disabled={!ready.length}
        title={ready.length ? undefined : '选中的素材还没有完成'}
        onClick={() => onAddShots(ready.map(card => card.id))}
      >
        <Icon name="plus" />
        <span>加入成片</span>
      </button>
      <button type="button" className="fo-small-button" disabled={busy} onClick={remove}>
        <Icon name="trash" />
        <span>删除</span>
      </button>
      <button type="button" className="fo-small-button" onClick={selection.clear}>
        <Icon name="x" />
        <span>取消选择</span>
      </button>
    </div>
  );
}

/** The box drawn while shift-dragging over empty canvas. */
export function SelectionMarquee({ rect }: { rect: Rect | null }) {
  if (!rect) return null;
  return <div className="fo-marquee" style={rect} aria-hidden="true" />;
}
