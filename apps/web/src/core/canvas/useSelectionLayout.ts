import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';
import type { Camera, GenerationMode } from '../../types';
import { CARD_HEIGHT, CARD_WIDTH, clamp } from './canvas-camera';

/**
 * Measures the canvas area and works out where the action bar of the selected card goes:
 * above the card when there is room, otherwise below, and always inside the visible area.
 */
export function useSelectionLayout({
  isActive,
  desktop,
  viewportRef,
  composerRef,
  selectionRef,
  camera,
  selectedPosition,
  hasSelection,
  mode,
  selectedJobStatus,
}: {
  isActive: boolean;
  desktop: boolean;
  viewportRef: RefObject<HTMLElement | null>;
  composerRef: RefObject<HTMLFormElement | null>;
  selectionRef: RefObject<HTMLDivElement | null>;
  camera: Camera;
  /** Where the selected card is right now, including while it is being dragged. */
  selectedPosition: { x: number; y: number } | undefined;
  // The bar changes size with these, so they trigger a new measurement.
  hasSelection: boolean;
  mode: GenerationMode;
  selectedJobStatus: string | undefined;
}) {
  const [layout, setLayout] = useState({
    width: 1200,
    height: 600,
    bottom: 400,
    promptBottom: 400,
    selectionWidth: 400,
    selectionHeight: 48,
  });
  useLayoutEffect(() => {
    if (!isActive) return;
    const measure = () => {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect?.width || !rect.height) return;
      const composerTop = composerRef.current?.getBoundingClientRect().top ?? rect.bottom;
      const bottom = desktop ? rect.bottom : composerTop;
      setLayout({
        width: rect.width,
        height: rect.height,
        bottom: bottom - rect.top - 12,
        // The card's prompt box is taller than the action bar: it always stays above the composer.
        promptBottom: Math.min(rect.bottom, composerTop) - rect.top - 12,
        selectionWidth: selectionRef.current?.offsetWidth ?? 400,
        selectionHeight: selectionRef.current?.offsetHeight ?? 48,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (viewportRef.current) observer.observe(viewportRef.current);
    if (selectionRef.current) observer.observe(selectionRef.current);
    if (composerRef.current) observer.observe(composerRef.current);
    return () => observer.disconnect();
  }, [
    desktop,
    isActive,
    hasSelection,
    mode,
    selectedJobStatus,
    viewportRef,
    composerRef,
    selectionRef,
  ]);
  let selectionStyle: CSSProperties = {};
  let outside = false;
  let selectedBox = { left: 0, top: 0, right: 0, bottom: 0 };
  let barBottom: number | undefined;
  if (selectedPosition) {
    const left = camera.x + selectedPosition.x * camera.zoom;
    const top = camera.y + selectedPosition.y * camera.zoom;
    const right = left + CARD_WIDTH * camera.zoom;
    const bottom = top + CARD_HEIGHT * camera.zoom;
    outside = right < 0 || left > layout.width || bottom < 0 || top > layout.height;
    let x = clamp(
      (left + right - layout.selectionWidth) / 2,
      12,
      Math.max(12, layout.width - layout.selectionWidth - 12),
    );
    let y = top - layout.selectionHeight - 12;
    if (y < 48) y = bottom + 12;
    y = clamp(y, 48, Math.max(48, layout.bottom - layout.selectionHeight));
    if (!desktop && x < 65 && y < 320) {
      if (70 + layout.selectionWidth < layout.width - 12) x = 70;
      else y = clamp(325, 48, Math.max(48, layout.bottom - layout.selectionHeight));
    }
    selectionStyle = { left: x, top: y };
    selectedBox = { left, top, right, bottom };
    // The bar normally sits above the card; when it had to go below, the prompt goes under it.
    if (y >= bottom) barBottom = y + layout.selectionHeight;
  }
  return { layout, selectionStyle, outside, selectedBox, barBottom };
}
