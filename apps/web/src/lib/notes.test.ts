import { describe, expect, it } from 'vitest';
import type { Card, Note, Workflow } from '../types';
import { createNote, linkedIds, restoreNotes, scriptProgress, scriptShots } from './notes';
import { restoreProject, serializeProject } from './project';

const note = (value: Partial<Note> = {}): Note => ({
  id: 'n1',
  x: 0,
  y: 0,
  kind: 'script',
  title: '脚本 1',
  text: '',
  ...value,
});
const card = (value: Partial<Card>): Card => ({
  id: 'c1',
  x: 0,
  y: 0,
  name: '画面',
  kind: 'image',
  src: 'https://example.com/a.png',
  ...value,
});

describe('notes', () => {
  it('reads one shot per non-empty line', () => {
    expect(scriptShots(' 清晨的森林 \n\n镜头拉近\n  ')).toEqual(['清晨的森林', '镜头拉近']);
  });

  it('names new notes by kind and keeps them from stacking', () => {
    const first = createNote('script', { x: 10, y: 10 }, []);
    const second = createNote('script', { x: 10, y: 10 }, [first]);
    const text = createNote('text', { x: 500, y: 10 }, [first, second]);
    expect([first.title, second.title, text.title]).toEqual(['脚本 1', '脚本 2', '文本 1']);
    expect(second).toMatchObject({ x: 45, y: 45 });
  });

  it('drops malformed and duplicate notes when restoring', () => {
    const restored = restoreNotes([
      note({ text: '一行' }),
      note({ text: '重复的 id' }),
      { id: 'n2', x: Number.NaN, y: 0 },
      { id: 'n3', x: 1, y: 2, kind: 'other', title: 5 },
      null,
    ]);
    expect(restored).toEqual([
      note({ text: '一行' }),
      { id: 'n3', x: 1, y: 2, kind: 'text', title: '', text: '' },
    ]);
    expect(restoreNotes('nope')).toEqual([]);
  });

  it('survives a save and reload with the script link on cards', () => {
    const saved = serializeProject({
      version: 1,
      title: '项目',
      camera: { x: 0, y: 0, zoom: 1 },
      selected: null,
      sequence: [],
      cards: [card({ noteId: 'n1' })],
      notes: [note({ text: '镜头一' })],
    });
    const restored = restoreProject(JSON.parse(JSON.stringify(saved)));
    expect(restored.notes).toEqual([note({ text: '镜头一' })]);
    expect(restored.cards[0].noteId).toBe('n1');
  });

  it('reports each shot by its image step, then its video step', () => {
    const workflow = {
      noteId: 'n1',
      steps: [
        { id: 'a', mode: 'image', status: 'succeeded', outputCardId: 'c1' },
        { id: 'b', mode: 'video', status: 'running', dependsOn: 'a' },
        { id: 'c', mode: 'image', status: 'queued' },
        { id: 'd', mode: 'video', status: 'queued', dependsOn: 'c' },
      ],
    } as Workflow;
    expect(scriptProgress('n1', workflow)).toEqual([
      { status: 'running', cardId: 'c1' },
      { status: 'queued', cardId: undefined },
    ]);
    expect(scriptProgress('other', workflow)).toBeUndefined();
  });

  it('links a card to its first frame, its videos and its script', () => {
    const project = {
      notes: [note()],
      cards: [
        card({ id: 'image', noteId: 'n1' }),
        card({ id: 'video', kind: 'video', sourceId: 'image', noteId: 'n1' }),
        card({ id: 'loose' }),
      ],
    };
    const fromImage = linkedIds(project, 'image', null);
    expect([...fromImage.cards]).toEqual(['video']);
    expect([...fromImage.notes]).toEqual(['n1']);
    expect([...linkedIds(project, 'video', null).cards]).toEqual(['image']);
    expect([...linkedIds(project, null, 'n1').cards]).toEqual(['image', 'video']);
    expect(linkedIds(project, 'loose', null).cards.size).toBe(0);
  });
});
