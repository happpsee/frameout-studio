import type { RefObject } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import type { ProjectState, UpdateProject } from '../../types';

/** Shortcuts wait while the user is typing, using the side panel, or a dialog is open. */
export const busyElsewhere = (event: KeyboardEvent) =>
  Boolean(
    (event.target as Element)?.closest?.(
      '.fo-work-panel,input,textarea,select,[role="combobox"],[role="listbox"],[contenteditable="true"]',
    ) || document.querySelector('dialog[open]'),
  );

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
  const on = { enabled: isActive, ignoreEventWhen: busyElsewhere, preventDefault: true };
  // These keys keep their normal browser meaning when the shortcut does nothing.
  const passive = { ...on, preventDefault: false };
  const history = (step: () => void) => () => {
    cancelGesture();
    if (!active) step();
  };

  // Both Cmd and Ctrl, on every platform: people coming from Windows press Ctrl+Z on a Mac too.
  useHotkeys(['meta+z', 'ctrl+z'], history(undo), on);
  useHotkeys(['meta+shift+z', 'ctrl+shift+z', 'meta+y', 'ctrl+y'], history(redo), on);
  useHotkeys(['mod+equal', 'mod+shift+equal', 'mod+add'], () => zoomBy(1.2), on);
  useHotkeys(['mod+minus', 'mod+subtract'], () => zoomBy(1 / 1.2), on);
  useHotkeys(['0', 'mod+0'], () => fitCanvas(), on);
  useHotkeys('alt+shift+f', () => tidyCanvas(), on);
  useHotkeys('v', () => setTool('select'), passive);
  useHotkeys('h', () => setTool('hand'), passive);
  useHotkeys(
    ['delete', 'backspace'],
    event => {
      if (!projectRef.current.selected) return;
      event.preventDefault();
      removeSelected();
    },
    passive,
  );
  useHotkeys(
    'escape',
    () => {
      setZoomOpen(false);
      update(draft => {
        draft.selected = null;
      }, false);
    },
    passive,
  );
}
