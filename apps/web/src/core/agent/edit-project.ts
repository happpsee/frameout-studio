import type { Note, ProjectState, SoundClip } from '../../types';
import { removeCards } from '../canvas/canvas-selection';
import { addReference, cardLinks, removeReference, renameLink } from '../canvas/card-links';
import { createNote } from '../canvas/notes';
import { addText, removeText } from '../canvas/text-links';
import { clampSound } from '../film/sound-clips';
import { serializeProject, uid } from '../project/project';
import { AgentCommandError } from './agent-bridge';

/**
 * A short fingerprint of what an agent can change. An edit carries the version it read, and is
 * refused when the project has changed since (the user may be working at the same time).
 * Where the camera is and what is selected do not count.
 */
export function projectVersion(project: ProjectState) {
  const { camera: _camera, selected: _selected, ...content } = serializeProject(project);
  const text = JSON.stringify(content);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

type Args = Record<string, unknown>;
const str = (args: Args, key: string) => {
  if (typeof args[key] !== 'string' || !args[key]) throw new Error(`缺少 ${key}`);
  return args[key] as string;
};
const num = (args: Args, key: string) => {
  const value = args[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${key} 需为数字`);
  return value;
};
const optional = <T>(args: Args, key: string, read: (args: Args, key: string) => T) =>
  args[key] === undefined ? undefined : read(args, key);

function card(draft: ProjectState, id: string) {
  const found = draft.cards.find(item => item.id === id);
  if (!found) throw new Error(`没有这张卡片：${id}`);
  return found;
}
function note(draft: ProjectState, id: string): Note {
  const found = draft.notes?.find(item => item.id === id.replace(/^note:/, ''));
  if (!found) throw new Error(`没有这条文本：${id}`);
  return found;
}
function sound(draft: ProjectState, id: string) {
  const index = draft.sounds?.findIndex(item => item.id === id) ?? -1;
  if (index < 0) throw new Error(`没有这段声音：${id}`);
  return index;
}

/** One change. Returns ids it created, if any; throws a message when it cannot be done. */
const OPERATIONS: Record<string, (draft: ProjectState, args: Args) => object | void> = {
  link(draft, args) {
    const from = str(args, 'from');
    const to = card(draft, str(args, 'to')).id;
    const linked = from.startsWith('note:')
      ? addText(draft, note(draft, from).id, to)
      : addReference(draft, card(draft, from).id, to);
    if (!linked) throw new Error('这条线已经有了，或者会连成一个圈');
  },
  unlink(draft, args) {
    const from = str(args, 'from');
    const to = str(args, 'to');
    if (from.startsWith('note:')) removeText(draft, `${from}>${to}:text`);
    else removeReference(draft, `${from}>${to}:reference`);
  },
  rename_link(draft, args) {
    const link = cardLinks(draft.cards).find(
      item => item.from.id === str(args, 'from') && item.to.id === str(args, 'to'),
    );
    if (!link) throw new Error('没有这条线');
    renameLink(draft, link, str(args, 'name'));
  },
  move_card(draft, args) {
    Object.assign(card(draft, str(args, 'cardId')), { x: num(args, 'x'), y: num(args, 'y') });
  },
  rename_card(draft, args) {
    card(draft, str(args, 'cardId')).name = str(args, 'name').slice(0, 80);
  },
  delete_cards(draft, args) {
    const ids = Array.isArray(args.cardIds) ? args.cardIds.map(String) : [];
    ids.forEach(id => card(draft, id));
    removeCards(draft, ids);
  },
  add_note(draft, args) {
    const kind = args.kind === 'script' ? 'script' : 'text';
    const point = { x: optional(args, 'x', num) ?? 0, y: optional(args, 'y', num) ?? 0 };
    const created = createNote(kind, point, draft.notes ?? []);
    created.title = optional(args, 'title', str) ?? created.title;
    created.text = optional(args, 'text', str) ?? '';
    (draft.notes ??= []).push(created);
    return { noteId: `note:${created.id}` };
  },
  update_note(draft, args) {
    const target = note(draft, str(args, 'noteId'));
    target.title = optional(args, 'title', str) ?? target.title;
    target.text = optional(args, 'text', str) ?? target.text;
  },
  delete_note(draft, args) {
    const id = note(draft, str(args, 'noteId')).id;
    draft.notes = draft.notes?.filter(item => item.id !== id);
    for (const item of draft.cards) item.textIds = item.textIds?.filter(text => text !== id);
  },
  set_consistency(draft, args) {
    const references = Array.isArray(args.references)
      ? args.references.map(id => card(draft, String(id)).id)
      : (draft.consistency?.references ?? []);
    draft.consistency = {
      notes: optional(args, 'notes', str) ?? draft.consistency?.notes ?? '',
      references,
    };
  },
  set_film(draft, args) {
    if (!Array.isArray(args.shots)) throw new Error('shots 需为数组');
    draft.sequence = args.shots.map(raw => {
      const shot = (raw ?? {}) as Args;
      const source = card(draft, str(shot, 'cardId'));
      const seconds = optional(shot, 'seconds', num) ?? source.duration ?? 4;
      return { id: uid(), cardId: source.id, duration: Math.min(15, Math.max(1, seconds)) };
    });
  },
  add_sound(draft, args) {
    const source = card(draft, str(args, 'cardId'));
    if (source.kind !== 'video') throw new Error('只能从视频取声音');
    const clip: SoundClip = clampSound(
      {
        id: `s-${uid()}`,
        cardId: source.id,
        from: optional(args, 'from', num) ?? 0,
        length: optional(args, 'length', num) ?? source.duration ?? 5,
        at: optional(args, 'at', num) ?? 0,
        mode: args.mode === 'replace' ? 'replace' : 'mix',
        volume: optional(args, 'volume', num) ?? 1,
      },
      source,
    );
    (draft.sounds ??= []).push(clip);
    return { soundId: clip.id };
  },
  update_sound(draft, args) {
    const index = sound(draft, str(args, 'soundId'));
    const current = draft.sounds![index];
    const patch: Partial<SoundClip> = {};
    for (const key of ['from', 'length', 'at', 'volume'] as const)
      if (args[key] !== undefined) patch[key] = num(args, key);
    if (args.mode !== undefined) patch.mode = args.mode === 'replace' ? 'replace' : 'mix';
    draft.sounds![index] = clampSound(
      { ...current, ...patch },
      draft.cards.find(item => item.id === current.cardId),
    );
  },
  remove_sound(draft, args) {
    draft.sounds!.splice(sound(draft, str(args, 'soundId')), 1);
  },
};

export const OPERATION_NAMES = Object.keys(OPERATIONS);

/**
 * Applies a batch of operations to a copy of the project. Any one failing fails the whole batch,
 * so the project is never left half-changed. Returns the changed copy and what each one created.
 */
export function applyOperations(project: ProjectState, operations: unknown) {
  if (!Array.isArray(operations) || !operations.length)
    throw new AgentCommandError('INVALID_ARGS', 'operations 需为非空数组');
  const draft = structuredClone(project);
  const results = operations.map((raw, index) => {
    const args = (raw ?? {}) as Args;
    const run = OPERATIONS[String(args.op)];
    try {
      if (!run) throw new Error(`不认识的操作，可用：${OPERATION_NAMES.join('、')}`);
      return { op: args.op, ...(run(draft, args) ?? {}) };
    } catch (error) {
      throw new AgentCommandError(
        'INVALID_OPERATION',
        `第 ${index + 1} 个操作（${String(args.op)}）没有执行：${(error as Error).message}。整批都未修改。`,
      );
    }
  });
  return { draft, results };
}
