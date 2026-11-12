import { useEffect, useRef, useState } from 'react';
import { clamp } from '../lib/canvas-camera';
import Icon from './Icon';

const MIN_ZOOM_PERCENT = 15;
const MAX_ZOOM_PERCENT = 400;
const ZOOM_STEP = 1.2;
const ZOOM_PRESETS = [50, 100, 200];

interface ZoomControlProps {
  /** Whether the zoom popover is open. The studio closes it on Escape and when hidden. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The studio is visible; outside clicks are only watched then. */
  active: boolean;
  /** Current zoom as a factor (1 = 100%). */
  zoom: number;
  onZoomBy: (factor: number) => void;
  /** Zoom to a percentage (100 = actual size). */
  onZoomToPercent: (percent: number) => void;
  onFit: () => void;
}

export default function ZoomControl({
  open,
  onOpenChange,
  active,
  zoom,
  onZoomBy,
  onZoomToPercent,
  onFit,
}: ZoomControlProps) {
  const container = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const [text, setText] = useState('80');
  const currentPercent = Math.round(zoom * 100);

  useEffect(() => {
    if (!active || !open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !container.current?.contains(event.target)) {
        onOpenChange(false);
      }
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [active, open, onOpenChange]);

  function close() {
    onOpenChange(false);
    toggle.current?.focus({ preventScroll: true });
  }

  function apply(percent: number) {
    if (!Number.isFinite(percent) || percent <= 0) return;
    onZoomToPercent(clamp(percent, MIN_ZOOM_PERCENT, MAX_ZOOM_PERCENT));
    close();
  }

  return (
    <div ref={container} className="fo-camera-tools" aria-label="缩放控制">
      <button
        type="button"
        className="fo-icon-button"
        aria-label="缩小"
        onClick={() => onZoomBy(1 / ZOOM_STEP)}
      >
        <Icon name="minus" />
      </button>
      <button
        ref={toggle}
        type="button"
        className="fo-zoom-label"
        aria-expanded={open}
        aria-controls="fo-zoom-popover"
        aria-haspopup="dialog"
        aria-label="缩放比例选项"
        onClick={() => {
          setText(String(currentPercent));
          onOpenChange(!open);
        }}
      >
        {currentPercent}%
      </button>
      <button
        type="button"
        className="fo-icon-button"
        aria-label="放大"
        onClick={() => onZoomBy(ZOOM_STEP)}
      >
        <Icon name="plus" />
      </button>
      <span className="fo-tool-divider" />
      <button type="button" className="fo-icon-button" aria-label="适应全部素材" onClick={onFit}>
        <Icon name="maximize" />
      </button>
      {open && (
        <div
          className="fo-zoom-popover"
          id="fo-zoom-popover"
          role="dialog"
          aria-label="画布缩放"
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              close();
            }
          }}
        >
          <form
            className="fo-zoom-form"
            onSubmit={event => {
              event.preventDefault();
              apply(Number(text.trim().replace(/%$/, '')));
            }}
          >
            <label htmlFor="fo-zoom-input">缩放比例</label>
            <div>
              <input
                autoFocus
                className="fo-zoom-input"
                id="fo-zoom-input"
                inputMode="decimal"
                aria-label="缩放比例"
                value={text}
                onChange={event => setText(event.target.value)}
                onFocus={event => event.target.select()}
              />
              <span>%</span>
              <button type="submit">应用</button>
            </div>
          </form>
          <div className="fo-zoom-presets">
            {ZOOM_PRESETS.map(value => (
              <button type="button" key={value} onClick={() => apply(value)}>
                {value}%
              </button>
            ))}
          </div>
          <button
            type="button"
            className="fo-zoom-fit"
            onClick={() => {
              onFit();
              close();
            }}
          >
            适应全部素材<span>⌘ / Ctrl 0</span>
          </button>
        </div>
      )}
    </div>
  );
}
