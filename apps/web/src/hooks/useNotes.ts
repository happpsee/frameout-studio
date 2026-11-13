import { useCallback, useEffect, useState, type RefObject } from 'react';
import type { Note, ProjectState, UpdateProject } from '../types';
import {
  NOTE_LIMIT,
  NOTE_TEXT_MAX,
  NOTE_TITLE_MAX,
  NOTE_WIDTH,
  createNote,
  scriptShots,
} from '../lib/notes';
import { CARD_WIDTH } from '../lib/canvas-camera';
import type { useWorkflow } from './useWorkflow';

/** Pressing these leaves the note selected: the note itself and the panels floating over the canvas. */
const keepsSelection = '.fo-note,.fo-composer,.fo-card-prompt,.fo-canvas-tools,.fo-camera-tools';
type Options = {
  projectRef: RefObject<ProjectState>;
  update: UpdateProject;
  viewportRef: RefObject<HTMLElement | null>;
  workflow: ReturnType<typeof useWorkflow>;
  /** Drops the card selection; a note and a card are never selected together. */
  clearCards: () => void;
  toast: (message: string) => void;
};

/** Text and script notes on the canvas: which one is selected, and every change to them. */
export function useNotes({
  projectRef,
  update,
  viewportRef,
  workflow,
  clearCards,
  toast,
}: Options) {
  const [selected, setSelected] = useState<string | null>(null);
  const cardSelected = projectRef.current.selected;
  useEffect(() => {
    if (cardSelected) setSelected(null);
  }, [cardSelected]);
  useEffect(() => {
    // A press anywhere else on the canvas deselects, as it does for cards.
    const down = (event: PointerEvent) => {
      const target = event.target as Element;
      if (target.closest?.('.fo-viewport') && !target.closest(keepsSelection)) setSelected(null);
    };
    document.addEventListener('pointerdown', down);
    return () => document.removeEventListener('pointerdown', down);
  }, []);

  const select = useCallback(
    (id: string) => {
      clearCards();
      setSelected(id);
    },
    [clearCards],
  );
  const add = useCallback(
    (kind: Note['kind']) => {
      const { camera, notes = [] } = projectRef.current;
      if (notes.length >= NOTE_LIMIT) {
        toast(`画布上最多 ${NOTE_LIMIT} 张文本和脚本卡片`);
        return;
      }
      const rect = viewportRef.current?.getBoundingClientRect();
      const note = createNote(
        kind,
        {
          x: ((rect?.width ?? 1000) / 2 - camera.x) / camera.zoom - NOTE_WIDTH / 2,
          y: ((rect?.height ?? 600) / 3 - camera.y) / camera.zoom,
        },
        notes,
      );
      update(draft => {
        (draft.notes ??= []).push(note);
      });
      select(note.id);
    },
    [projectRef, viewportRef, update, select, toast],
  );
  const change = useCallback(
    // `record` false folds a keystroke into the undo step that began the edit.
    (id: string, patch: Partial<Pick<Note, 'title' | 'text' | 'kind'>>, record = true) =>
      update(draft => {
        const note = draft.notes?.find(item => item.id === id);
        if (!note) return;
        if (patch.title !== undefined) note.title = patch.title.slice(0, NOTE_TITLE_MAX);
        if (patch.text !== undefined) note.text = patch.text.slice(0, NOTE_TEXT_MAX);
        if (patch.kind) note.kind = patch.kind;
      }, record),
    [update],
  );
  const move = useCallback(
    (id: string, x: number, y: number) =>
      update(draft => {
        const note = draft.notes?.find(item => item.id === id);
        if (note) Object.assign(note, { x, y });
      }),
    [update],
  );
  const remove = useCallback(
    (id: string) => {
      if (projectRef.current.workflow?.noteId === id && workflow.running) {
        toast('先暂停这份脚本的生成，再删除它');
        return;
      }
      update(draft => {
        draft.notes = draft.notes?.filter(item => item.id !== id);
      });
      setSelected(null);
    },
    [projectRef, update, workflow.running, toast],
  );
  /** Makes a shot plan from a script; results are laid out to the right of the note. */
  const plan = useCallback(
    (id: string, withVideo: boolean) => {
      const note = projectRef.current.notes?.find(item => item.id === id);
      if (!note) return;
      try {
        workflow.plan(note.text, withVideo, {
          noteId: id,
          origin: { x: note.x + NOTE_WIDTH + (CARD_WIDTH - NOTE_WIDTH) + 80, y: note.y },
        });
        toast(`已编排 ${scriptShots(note.text).length} 个镜头，检查后点「开始生成」`);
      } catch (error) {
        toast(error instanceof Error ? error.message : '编排失败');
      }
    },
    [projectRef, workflow, toast],
  );
  return { selected, select, add, change, move, remove, plan };
}
