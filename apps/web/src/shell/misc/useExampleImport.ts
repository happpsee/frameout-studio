import { useEffect, useRef } from 'react';
import type { Camera, ProjectState, UpdateProject } from '../../types';
import { CARD_CENTER, CARD_HEIGHT, CARD_WIDTH } from '../../core/canvas/canvas-camera';
import { exampleCards, takeExampleRequest } from './examples';
import { DEFAULT_PROJECT_TITLE } from '../../core/project/project';

interface ExampleImportOptions {
  /** Whether the studio is showing; an example request is picked up when it opens. */
  active: boolean;
  projectRef: { readonly current: ProjectState };
  update: UpdateProject;
  viewportRef: { readonly current: HTMLElement | null };
  camera: Camera;
  restoreCamera: (camera: Camera) => void;
  setPrompt: (prompt: string) => void;
  toast: (message: string) => void;
}

/**
 * Opens a landing-page example: adds its images next to the user's work (never replacing it)
 * as one undo step, selects the last one, frames it and puts a next-step prompt in the box.
 */
export function useExampleImport(options: ExampleImportOptions) {
  const latest = useRef(options);
  latest.current = options;
  const { active } = options;
  useEffect(() => {
    if (!active) return;
    const example = takeExampleRequest();
    if (!example) return;
    const { projectRef, update, viewportRef, camera, restoreCamera, setPrompt, toast } =
      latest.current;
    const project = projectRef.current;
    const rect = viewportRef.current?.getBoundingClientRect();
    const fallback = {
      x: ((rect?.width ?? 1000) / 2 - camera.x) / camera.zoom - CARD_CENTER.x,
      y: ((rect?.height ?? 600) / 2 - camera.y) / camera.zoom - CARD_CENTER.y,
    };
    const { added, cards } = exampleCards(example, project.cards, fallback);
    const untitled = !project.cards.length && project.title === DEFAULT_PROJECT_TITLE;
    update(draft => {
      draft.cards.push(...added);
      draft.selected = cards.at(-1)!.id;
      if (untitled) draft.title = example.name;
    });
    setPrompt(example.prompt);
    if (rect?.width) {
      const left = Math.min(...cards.map(card => card.x));
      const top = Math.min(...cards.map(card => card.y));
      const right = Math.max(...cards.map(card => card.x)) + CARD_WIDTH;
      const bottom = Math.max(...cards.map(card => card.y)) + CARD_HEIGHT;
      restoreCamera({
        zoom: camera.zoom,
        x: rect.width / 2 - ((left + right) / 2) * camera.zoom,
        y: rect.height / 2 - ((top + bottom) / 2) * camera.zoom,
      });
    }
    toast(
      added.length
        ? `已添加示例素材「${example.name}」· 选中后点「图生视频」让它动起来`
        : `示例素材「${example.name}」已在画布上`,
    );
  }, [active]);
}
