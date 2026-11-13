import type { Note, ProjectState, StepStatus, Workflow } from '../types';
import { uid } from './project';

/** Width of a note on the canvas at zoom 1. Keep in step with `.fo-note` in CanvasNote.css. */
export const NOTE_WIDTH = 300;
/** A note grows with its text; this is the height used to frame the canvas. */
export const NOTE_HEIGHT = 220;
export const NOTE_LIMIT = 40;
export const NOTE_TEXT_MAX = 8000;
export const NOTE_TITLE_MAX = 40;
/** A shot plan runs at most this many shots; see createWorkflow. */
export const SCRIPT_SHOT_MAX = 8;

/** One shot per non-empty line. */
export const scriptShots = (text: string) =>
  text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

export function createNote(
  kind: Note['kind'],
  point: { x: number; y: number },
  existing: Note[],
): Note {
  const count = existing.filter(note => note.kind === kind).length + 1;
  const position = { ...point };
  // A second note added without moving the canvas must not hide the first.
  while (
    existing.some(note => Math.abs(note.x - position.x) < 8 && Math.abs(note.y - position.y) < 8)
  ) {
    position.x += 35;
    position.y += 35;
  }
  return {
    id: uid(),
    ...position,
    kind,
    title: `${kind === 'script' ? '脚本' : '文本'} ${count}`,
    text: '',
  };
}

/** Valid notes from saved data; anything malformed is dropped. */
export function restoreNotes(input: unknown): Note[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  return input
    .filter((note): note is Note => {
      if (
        !note ||
        typeof note.id !== 'string' ||
        seen.has(note.id) ||
        !Number.isFinite(note.x) ||
        !Number.isFinite(note.y)
      )
        return false;
      seen.add(note.id);
      return true;
    })
    .slice(0, NOTE_LIMIT)
    .map(note => ({
      id: note.id,
      x: note.x,
      y: note.y,
      kind: note.kind === 'script' ? 'script' : 'text',
      title: typeof note.title === 'string' ? note.title.slice(0, NOTE_TITLE_MAX) : '',
      text: typeof note.text === 'string' ? note.text.slice(0, NOTE_TEXT_MAX) : '',
    }));
}

export type ShotProgress = { status: StepStatus; cardId?: string };
/**
 * Where each shot of a script stands in the plan made from it: the image step, or the video
 * step once the image is done. Undefined when the plan belongs to another script or none.
 */
export function scriptProgress(noteId: string, workflow?: Workflow): ShotProgress[] | undefined {
  if (!workflow || workflow.noteId !== noteId) return;
  return workflow.steps
    .filter(step => step.mode === 'image')
    .map(image => {
      const video = workflow.steps.find(step => step.dependsOn === image.id);
      const step = video && image.status === 'succeeded' ? video : image;
      return { status: step.status, cardId: step.outputCardId ?? image.outputCardId };
    });
}

/**
 * What the current selection is connected to: the first frame a video came from, the videos
 * made from an image, and the script behind a card; for a script, every card made from it.
 */
export function linkedIds(
  project: Pick<ProjectState, 'cards' | 'notes'>,
  cardId: string | null,
  noteId: string | null,
) {
  const cards = new Set<string>();
  const notes = new Set<string>();
  if (noteId) {
    for (const card of project.cards) if (card.noteId === noteId) cards.add(card.id);
  } else if (cardId) {
    const selected = project.cards.find(card => card.id === cardId);
    if (selected?.sourceId) cards.add(selected.sourceId);
    for (const card of project.cards) if (card.sourceId === cardId) cards.add(card.id);
    if (selected?.noteId && project.notes?.some(note => note.id === selected.noteId))
      notes.add(selected.noteId);
  }
  return { cards, notes };
}
