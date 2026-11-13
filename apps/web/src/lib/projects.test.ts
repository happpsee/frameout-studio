// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHECKPOINTS_STORAGE_KEY,
  PROJECT_STORAGE_KEY,
  PROJECTS_INDEX_KEY,
  flushDesktopStorage,
  loadDesktopStorage,
  readStoredValue,
} from './desktop-storage';
import { initialState } from './project';
import {
  DAMAGED_INDEX_KEY,
  DELETED_PROJECT_RETENTION_MS,
  createProject,
  deleteProject,
  findProject,
  lastOpenedProjectId,
  listDeletedProjects,
  listProjects,
  markProjectOpened,
  prepareProject,
  projectDataKeys,
  purgeDeletedProjects,
  recordProjectSave,
  renameProject,
  restoreDeletedProject,
  subscribeProjects,
  summarizeProject,
} from './projects';
import type { Card, ProjectState } from '../types';

const DAY = 24 * 60 * 60 * 1000;
const bytes = (value: string) => new TextEncoder().encode(value).buffer;
const text = (value: ArrayBuffer | undefined) => (value ? new TextDecoder().decode(value) : null);
const card = (id: string, extra: Partial<Card> = {}): Card => ({
  id,
  x: 0,
  y: 0,
  name: id,
  kind: 'image',
  src: `https://media.example/${id}.webp`,
  ...extra,
});
function legacyProject(edit: (project: ProjectState) => void = () => {}) {
  const project = initialState();
  edit(project);
  return JSON.stringify(project);
}

beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('moving the single workspace into projects', () => {
  it('turns a used workspace into a project, keeping its title, contents and versions', () => {
    const legacy = legacyProject(project => {
      project.title = '森林短片';
      project.cards = [card('a'), card('b', { kind: 'video', mediaId: 'media-b', src: '' })];
      project.sequence = [{ id: 's1', cardId: 'b', duration: 6 }];
    });
    const versions = JSON.stringify([
      { id: 'v1', name: '第一稿', createdAt: 1, state: initialState() },
    ]);
    localStorage.setItem(PROJECT_STORAGE_KEY, legacy);
    localStorage.setItem(CHECKPOINTS_STORAGE_KEY, versions);
    const [project] = listProjects();
    expect(listProjects()).toHaveLength(1);
    expect(project).toMatchObject({
      title: '森林短片',
      cardCount: 2,
      shotCount: 1,
      durationSeconds: 6,
      coverMediaId: 'media-b',
      coverKind: 'video',
    });
    expect(project.id).toMatch(/^[a-z0-9]+$/);
    const keys = projectDataKeys(project.id);
    expect(keys.project).toBe(`frameout-project-${project.id}`);
    expect(localStorage.getItem(keys.project)).toBe(legacy);
    expect(localStorage.getItem(keys.checkpoints)).toBe(versions);
    // The old keys stay as a backup.
    expect(localStorage.getItem(PROJECT_STORAGE_KEY)).toBe(legacy);
    expect(localStorage.getItem(CHECKPOINTS_STORAGE_KEY)).toBe(versions);
    expect(lastOpenedProjectId()).toBe(project.id);
  });

  it('migrates once: later starts and a changed backup do not add projects', () => {
    localStorage.setItem(
      PROJECT_STORAGE_KEY,
      legacyProject(p => (p.cards = [card('a')])),
    );
    const [first] = listProjects();
    localStorage.setItem(
      PROJECT_STORAGE_KEY,
      legacyProject(p => (p.cards = [card('z')])),
    );
    expect(listProjects().map(project => project.id)).toEqual([first.id]);
    createProject('新项目');
    expect(listProjects()).toHaveLength(2);
  });

  it('migrates again after an interruption before the list was stored', async () => {
    const legacy = legacyProject(p => (p.title = '只改了名字'));
    localStorage.setItem(PROJECT_STORAGE_KEY, legacy);
    const [first] = listProjects();
    // Simulate a crash after copying: the list never reached storage.
    localStorage.removeItem(PROJECTS_INDEX_KEY);
    vi.resetModules();
    const fresh = await import('./projects');
    const [again] = fresh.listProjects();
    expect(again.title).toBe('只改了名字');
    expect(localStorage.getItem(fresh.projectDataKeys(again.id).project)).toBe(legacy);
    expect(localStorage.getItem(PROJECT_STORAGE_KEY)).toBe(legacy);
    expect(first.id).toBeTruthy();
  });

  it.each([
    ['nothing saved', null],
    ['an untouched workspace', legacyProject()],
    ['a damaged value', '{damaged'],
    ['an unknown format', JSON.stringify({ version: 9, cards: 'x' })],
  ])('starts with an empty list for %s, leaving the old keys alone', (_name, legacy) => {
    if (legacy !== null) localStorage.setItem(PROJECT_STORAGE_KEY, legacy);
    expect(listProjects()).toEqual([]);
    expect(listDeletedProjects()).toEqual([]);
    expect(lastOpenedProjectId()).toBeNull();
    expect(localStorage.getItem(PROJECT_STORAGE_KEY)).toBe(legacy);
    expect(JSON.parse(localStorage.getItem(PROJECTS_INDEX_KEY)!)).toEqual({
      version: 1,
      projects: [],
    });
  });

  it('counts saved versions alone as a used workspace', () => {
    localStorage.setItem(PROJECT_STORAGE_KEY, legacyProject());
    localStorage.setItem(
      CHECKPOINTS_STORAGE_KEY,
      JSON.stringify([{ id: 'v1', name: '第一稿', createdAt: 1, state: initialState() }]),
    );
    expect(listProjects()).toHaveLength(1);
  });

  it('keeps using the old keys when browser storage is too full to copy them', () => {
    const legacy = legacyProject(p => (p.cards = [card('a')]));
    localStorage.setItem(PROJECT_STORAGE_KEY, legacy);
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key.startsWith('frameout-project-')) throw new DOMException('full', 'QuotaExceededError');
      setItem.call(this, key, value);
    });
    const [project] = listProjects();
    expect(project.cardCount).toBe(1);
    expect(projectDataKeys(project.id)).toEqual({
      project: PROJECT_STORAGE_KEY,
      checkpoints: CHECKPOINTS_STORAGE_KEY,
    });
    // Purging it later never removes the backup keys.
    vi.restoreAllMocks();
    deleteProject(project.id);
    purgeDeletedProjects(Date.now() + DELETED_PROJECT_RETENTION_MS + DAY);
    expect(listDeletedProjects()).toEqual([]);
    expect(localStorage.getItem(PROJECT_STORAGE_KEY)).toBe(legacy);
  });

  it('keeps a damaged list aside instead of overwriting it', () => {
    localStorage.setItem(PROJECTS_INDEX_KEY, '{damaged');
    expect(listProjects()).toEqual([]);
    createProject('重新开始');
    expect(localStorage.getItem(DAMAGED_INDEX_KEY)).toBe('{damaged');
    expect(listProjects().map(project => project.title)).toEqual(['重新开始']);
  });

  it('on desktop, stores the list only after the copied project is on disk', async () => {
    let finishCopy!: () => void;
    const files = new Map<string, ArrayBuffer>([
      [PROJECT_STORAGE_KEY, bytes(legacyProject(p => (p.cards = [card('a')])))],
    ]);
    const write = vi.fn(async (key: string, value: ArrayBuffer) => {
      if (key.startsWith('frameout-project-'))
        await new Promise<void>(resolve => (finishCopy = resolve));
      files.set(key, value);
    });
    vi.stubGlobal('frameoutDesktop', {
      storage: { read: async (key: string) => files.get(key) ?? null, write },
      onBeforeClose: () => () => {},
    });
    await loadDesktopStorage();
    const [project] = listProjects();
    expect(project.cardCount).toBe(1);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(files.has(PROJECTS_INDEX_KEY)).toBe(false);
    finishCopy();
    await flushDesktopStorage();
    expect(text(files.get(PROJECTS_INDEX_KEY))).toContain(project.id);
    expect(text(files.get(`frameout-project-${project.id}`))).toContain('"cards"');
    expect(text(files.get(PROJECT_STORAGE_KEY))).toContain('"cards"');
  });
});

describe('project list', () => {
  it('creates projects with a normalized title and saved contents, newest change first', () => {
    vi.useFakeTimers({ now: 1000 });
    const first = createProject();
    vi.setSystemTime(2000);
    const second = createProject('  海边   短片 ');
    expect(first.title).toBe('未命名项目');
    expect(second).toMatchObject({ title: '海边 短片', createdAt: 2000, updatedAt: 2000 });
    expect(listProjects().map(project => project.id)).toEqual([second.id, first.id]);
    expect(JSON.parse(localStorage.getItem(projectDataKeys(second.id).project)!).title).toBe(
      '海边 短片',
    );
    expect(first.id).not.toBe(second.id);
  });

  it('renames like the studio does and ignores unknown ids', () => {
    const project = createProject('旧名字');
    renameProject(project.id, '   ');
    expect(findProject(project.id)?.title).toBe('未命名项目');
    renameProject(project.id, 'x'.repeat(60));
    expect(findProject(project.id)?.title).toHaveLength(40);
    renameProject('missing', '无效');
    expect(listProjects()).toHaveLength(1);
  });

  it('moves projects to 已删除项目 and back, and forgets the last opened one when deleted', () => {
    vi.useFakeTimers({ now: 10_000 });
    const a = createProject('甲');
    const b = createProject('乙');
    markProjectOpened(a.id);
    expect(lastOpenedProjectId()).toBe(a.id);
    deleteProject(a.id);
    vi.setSystemTime(20_000);
    deleteProject(b.id);
    expect(listProjects()).toEqual([]);
    expect(listDeletedProjects().map(project => [project.title, project.deletedAt])).toEqual([
      ['乙', 20_000],
      ['甲', 10_000],
    ]);
    expect(lastOpenedProjectId()).toBeNull();
    restoreDeletedProject(a.id);
    expect(listProjects().map(project => project.id)).toEqual([a.id]);
    expect(findProject(a.id)?.deletedAt).toBeUndefined();
  });

  it('purges only projects deleted more than 30 days ago, with their data', () => {
    const now = Date.now();
    const old = createProject('旧的');
    const recent = createProject('新删的');
    const kept = createProject('留着');
    deleteProject(old.id);
    deleteProject(recent.id);
    const keys = projectDataKeys(old.id);
    localStorage.setItem(keys.checkpoints, '[]');
    purgeDeletedProjects(now + DELETED_PROJECT_RETENTION_MS - DAY);
    expect(listDeletedProjects()).toHaveLength(2);
    const stored = JSON.parse(localStorage.getItem(PROJECTS_INDEX_KEY)!);
    stored.projects.find((p: { id: string }) => p.id === recent.id).deletedAt = now + DAY;
    localStorage.setItem(PROJECTS_INDEX_KEY, JSON.stringify(stored));
    purgeDeletedProjects(now + DELETED_PROJECT_RETENTION_MS + 1000);
    expect(listDeletedProjects().map(project => project.id)).toEqual([recent.id]);
    expect(findProject(old.id)).toBeUndefined();
    expect(localStorage.getItem(keys.project)).toBeNull();
    expect(localStorage.getItem(keys.checkpoints)).toBeNull();
    expect(listProjects().map(project => project.id)).toEqual([kept.id]);
  });

  it('notifies subscribers of changes here and in other tabs, and returns stable lists', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeProjects(listener);
    const project = createProject();
    expect(listener).toHaveBeenCalledTimes(1);
    const list = listProjects();
    expect(listProjects()).toBe(list);
    renameProject(project.id, '新名字');
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listProjects()).not.toBe(list);
    renameProject(project.id, '新名字');
    expect(listener).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new StorageEvent('storage', { key: PROJECTS_INDEX_KEY }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'frameout-theme' }));
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    deleteProject(project.id);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('ignores the last opened id once that project is deleted or missing', () => {
    const project = createProject();
    markProjectOpened('missing');
    expect(lastOpenedProjectId()).toBeNull();
    markProjectOpened(project.id);
    expect(lastOpenedProjectId()).toBe(project.id);
  });
});

describe('project summaries', () => {
  it('uses the first playable shot as the cover, else the latest finished card', () => {
    const cards = [
      card('old'),
      card('temp', { remoteTemporary: true }),
      card('pending', { kind: 'video', job: { status: 'running' } as Card['job'] }),
      card('session', { sessionOnly: true }),
    ];
    expect(summarizeProject({ title: '', cards, sequence: [] })).toMatchObject({
      title: '未命名项目',
      cardCount: 3,
      coverSrc: 'https://media.example/old.webp',
      coverKind: 'image',
    });
    const withShots = summarizeProject({
      title: '片子',
      cards: [...cards, card('shot', { mediaId: 'media-shot', src: 'blob:x' })],
      sequence: [
        { id: 's0', cardId: 'missing', duration: 3 },
        { id: 's1', cardId: 'pending', duration: 5 },
        { id: 's2', cardId: 'shot', duration: 4.5 },
      ],
    });
    expect(withShots).toMatchObject({
      shotCount: 2,
      durationSeconds: 9.5,
      coverMediaId: 'media-shot',
      coverKind: 'image',
    });
    expect(withShots.coverSrc).toBeUndefined();
    expect(
      summarizeProject({ title: 'x', cards: [card('t', { remoteTemporary: true })], sequence: [] })
        .coverSrc,
    ).toBeUndefined();
  });

  it('updates the entry on save and moves it up only when the contents changed', () => {
    vi.useFakeTimers({ now: 1000 });
    const project = createProject('甲');
    vi.setSystemTime(5000);
    const listener = vi.fn();
    subscribeProjects(listener);
    recordProjectSave(project.id, { title: '甲', cards: [], sequence: [] }, false);
    expect(listener).not.toHaveBeenCalled();
    recordProjectSave(project.id, { title: '甲', cards: [card('a')], sequence: [] }, false);
    expect(findProject(project.id)).toMatchObject({ cardCount: 1, updatedAt: 1000 });
    recordProjectSave(project.id, { title: '乙', cards: [], sequence: [] }, true);
    expect(findProject(project.id)).toMatchObject({ title: '乙', cardCount: 0, updatedAt: 5000 });
    expect(findProject(project.id)?.coverSrc).toBeUndefined();
    recordProjectSave('missing', { title: '丙', cards: [], sequence: [] }, true);
    expect(findProject('missing')).toBeUndefined();
  });
});

describe('opening a project on desktop', () => {
  it('loads its files before the studio reads them and refuses a damaged one', async () => {
    const files = new Map<string, ArrayBuffer>();
    vi.stubGlobal('frameoutDesktop', {
      storage: {
        read: async (key: string) => files.get(key) ?? null,
        write: async (key: string, value: ArrayBuffer) => {
          files.set(key, value);
        },
      },
      onBeforeClose: () => () => {},
    });
    await loadDesktopStorage();
    const good = createProject('好的');
    const bad = createProject('坏的');
    await flushDesktopStorage();
    files.set(projectDataKeys(good.id).checkpoints, bytes('[]'));
    files.set(projectDataKeys(bad.id).project, bytes('{damaged'));
    // A restart: only settings and the list are read up front.
    await loadDesktopStorage();
    expect(listProjects()).toHaveLength(2);
    expect(readStoredValue(projectDataKeys(good.id).project)).toBeNull();
    await prepareProject(good.id);
    expect(JSON.parse(readStoredValue(projectDataKeys(good.id).project)!).title).toBe('好的');
    expect(readStoredValue(projectDataKeys(good.id).checkpoints)).toBe('[]');
    await expect(prepareProject(bad.id)).rejects.toThrow('项目文件格式无法读取');
    expect(text(files.get(projectDataKeys(bad.id).project))).toBe('{damaged');
  });

  it('empties files when purging, since the desktop bridge cannot delete them', async () => {
    const files = new Map<string, ArrayBuffer>();
    vi.stubGlobal('frameoutDesktop', {
      storage: {
        read: async (key: string) => files.get(key) ?? null,
        write: async (key: string, value: ArrayBuffer) => {
          files.set(key, value);
        },
      },
      onBeforeClose: () => () => {},
    });
    await loadDesktopStorage();
    const project = createProject('要删的');
    deleteProject(project.id);
    purgeDeletedProjects(Date.now() + DELETED_PROJECT_RETENTION_MS + DAY);
    await flushDesktopStorage();
    expect(files.get(projectDataKeys(project.id).project)!.byteLength).toBe(0);
    await loadDesktopStorage();
    expect(findProject(project.id)).toBeUndefined();
    await prepareProject(project.id);
    expect(readStoredValue(projectDataKeys(project.id).project)).toBeNull();
  });

  it('does nothing in the browser', async () => {
    const project = createProject();
    await expect(prepareProject(project.id)).resolves.toBeUndefined();
  });
});
