import { describe, expect, it } from 'vitest';
import type { Card, Note } from '../types';
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
});
