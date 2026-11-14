import { useEffect, type RefObject } from 'react';
import type { ProjectState, UpdateProject } from '../../types';

/** Keyboard shortcuts of the studio: undo and redo, zoom, fit, tidy, delete, tools, Escape. */
export function useStudioShortcuts({
  isActive,
  active,
  undo,
  redo,
  cancelGesture,
  fitCanvas,
  zoomBy,
  setTool,
  projectRef,
  removeSelected,
  update,
  tidyCanvas,
  setZoomOpen,
}: {
  /** The studio is the page on screen. */
  isActive: boolean;
  /** A generation is running; undo and redo wait for it. */
  active: boolean;
  undo: () => void;
  redo: () => void;
  cancelGesture: () => void;
  fitCanvas: () => void;
  zoomBy: (factor: number) => void;
  setTool: (tool: 'select' | 'hand') => void;
  projectRef: RefObject<ProjectState>;
  removeSelected: () => void;
  update: UpdateProject;
  tidyCanvas: () => void;
  setZoomOpen: (open: boolean) => void;
}) {
  useEffect(() => {
    if (!isActive) return;
    const keydown = (event: KeyboardEvent) => {
      if (
        (event.target as Element)?.closest?.(
          '.fo-work-panel,input,textarea,select,[role="combobox"],[role="listbox"],[contenteditable="true"]',
        ) ||
        document.querySelector('dialog[open]')
      )
        return;
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        cancelGesture();
        if (!active) {
          if (event.shiftKey) redo();
          else undo();
        }
      } else if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        cancelGesture();
        if (!active) redo();
      } else if (mod && ['+', '=', '-'].includes(event.key)) {
        event.preventDefault();
        zoomBy(event.key === '-' ? 1 / 1.2 : 1.2);
      } else if (event.altKey && event.shiftKey && event.code === 'KeyF') {
        event.preventDefault();
        tidyCanvas();
      } else if (event.key === '0') {
        event.preventDefault();
        fitCanvas();
      } else if (['Delete', 'Backspace'].includes(event.key) && projectRef.current.selected) {
        event.preventDefault();
        removeSelected();
      } else if (!mod && event.key.toLowerCase() === 'v') setTool('select');
      else if (!mod && event.key.toLowerCase() === 'h') setTool('hand');
      else if (event.key === 'Escape') {
        setZoomOpen(false);
        update(draft => {
          draft.selected = null;
        }, false);
      }
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [
    isActive,
    active,
    undo,
    redo,
    cancelGesture,
    fitCanvas,
    zoomBy,
    setTool,
    projectRef,
    removeSelected,
    update,
    tidyCanvas,
    setZoomOpen,
  ]);
}
