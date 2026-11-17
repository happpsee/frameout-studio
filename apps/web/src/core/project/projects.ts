import type { Card, ProjectState } from '../../types';
import {
  CHECKPOINTS_STORAGE_KEY,
  PROJECT_STORAGE_KEY,
  PROJECTS_INDEX_KEY,
  loadDesktopKeys,
  readStoredValue,
  removeStoredValue,
  writeStoredValue,
} from './desktop-storage';
import { isDesktop } from '../../platform';
import {
  DEFAULT_PROJECT_TITLE,
  initialState,
  normalizeProjectTitle,
  restoreProject,
  serializeProject,
} from './project';
import { randomId } from './random-id';

export interface ProjectSummary {
  /** Stable, lowercase letters and digits; used inside storage keys. */
  id: string;
  title: string;
  createdAt: number;
  /** Last content change (cards or sequence), not opening, panning or renaming. */
  updatedAt: number;
  cardCount: number;
  /** Shots in the sequence (成片). */
  shotCount: number;
  durationSeconds: number;
  /** Media-store id of the cover: first sequence shot, else the latest finished card. */
  coverMediaId?: string;
  /** Cover URL when there is no media id (bundled asset or a lasting link). */
  coverSrc?: string;
  coverKind?: 'image' | 'video';
  /** Set while the project is in 已删除项目. */
  deletedAt?: number;
}
/** `storage: 'legacy'` keeps a migrated project in the pre-project keys (browser storage was full). */
type StoredProject = ProjectSummary & { storage?: 'legacy' };
interface ProjectIndex {
  version: 1;
  lastOpenedId?: string;
  projects: StoredProject[];
}
type Summary = Omit<ProjectSummary, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>;

/** Deleted projects are kept this long before purgeDeletedProjects drops them. */
export const DELETED_PROJECT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** A damaged index is copied here before a new one replaces it. */
export const DAMAGED_INDEX_KEY = 'frameout-projects-v1-damaged';
const ID = /^[a-z0-9]{1,40}$/;
const SUMMARY_FIELDS = [
  'title',
  'cardCount',
  'shotCount',
  'durationSeconds',
  'coverMediaId',
  'coverSrc',
  'coverKind',
] as const;

const listeners = new Set<() => void>();
// Used when the index could not be stored at all, so this session still works.
let memoryIndex: string | null = null;
let cache:
  | { raw: string; index: ProjectIndex; active: ProjectSummary[]; deleted: ProjectSummary[] }
  | undefined;

export function projectDataKeys(id: string): { project: string; checkpoints: string } {
  if (findStored(id)?.storage === 'legacy')
    return { project: PROJECT_STORAGE_KEY, checkpoints: CHECKPOINTS_STORAGE_KEY };
  return { project: `frameout-project-${id}`, checkpoints: `frameout-checkpoints-${id}` };
}

const finite = (value: unknown, fallback = 0) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

function cleanEntry(value: unknown): StoredProject | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'string' || !ID.test(raw.id)) return null;
  const entry: StoredProject = {
    id: raw.id,
    title: typeof raw.title === 'string' && raw.title ? raw.title : DEFAULT_PROJECT_TITLE,
    createdAt: finite(raw.createdAt),
    updatedAt: finite(raw.updatedAt),
    cardCount: finite(raw.cardCount),
    shotCount: finite(raw.shotCount),
    durationSeconds: finite(raw.durationSeconds),
  };
  if (typeof raw.coverMediaId === 'string') entry.coverMediaId = raw.coverMediaId;
  if (typeof raw.coverSrc === 'string') entry.coverSrc = raw.coverSrc;
  if (raw.coverKind === 'image' || raw.coverKind === 'video') entry.coverKind = raw.coverKind;
  if (typeof raw.deletedAt === 'number' && Number.isFinite(raw.deletedAt))
    entry.deletedAt = raw.deletedAt;
  if (raw.storage === 'legacy') entry.storage = 'legacy';
  return entry;
}

function parseIndex(raw: string): ProjectIndex {
  let saved: unknown;
  try {
    saved = JSON.parse(raw);
  } catch {
    return { version: 1, projects: [] };
  }
  const value = saved as Partial<ProjectIndex> | null;
  const seen = new Set<string>();
  const projects = (Array.isArray(value?.projects) ? value.projects : [])
    .map(cleanEntry)
    .filter((entry): entry is StoredProject => {
      if (!entry || seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    });
  const index: ProjectIndex = { version: 1, projects };
  if (typeof value?.lastOpenedId === 'string') index.lastOpenedId = value.lastOpenedId;
  return index;
}

function isDamaged(raw: string): boolean {
  try {
    const value = JSON.parse(raw);
    return !value || typeof value !== 'object' || !Array.isArray(value.projects);
  } catch {
    return true;
  }
}

function readIndex() {
  const raw = readStoredValue(PROJECTS_INDEX_KEY) || memoryIndex || migrateLegacyWorkspace();
  if (cache?.raw !== raw) {
    const index = parseIndex(raw);
    cache = {
      raw,
      index,
      active: index.projects
        .filter(entry => entry.deletedAt === undefined)
        .sort((a, b) => b.updatedAt - a.updatedAt),
      deleted: index.projects
        .filter(entry => entry.deletedAt !== undefined)
        .sort((a, b) => b.deletedAt! - a.deletedAt!),
    };
  }
  return cache;
}

const findStored = (id: string) => readIndex().index.projects.find(entry => entry.id === id);

function storeIndex(raw: string, after?: Promise<unknown>) {
  const previous = readStoredValue(PROJECTS_INDEX_KEY);
  try {
    if (previous && isDamaged(previous))
      void writeStoredValue(DAMAGED_INDEX_KEY, previous)?.catch(() => {});
  } catch {
    /* Best effort: the damaged index could not be read anyway. */
  }
  try {
    void writeStoredValue(PROJECTS_INDEX_KEY, raw, after)?.catch(() => {});
    memoryIndex = null;
  } catch {
    memoryIndex = raw;
  }
}

/** Applies a change to a fresh copy of the stored index; `change` returns false to skip writing. */
function changeIndex(change: (index: ProjectIndex) => boolean | void) {
  const index: ProjectIndex = JSON.parse(JSON.stringify(readIndex().index));
  if (change(index) === false) return;
  storeIndex(JSON.stringify(index));
  listeners.forEach(listener => listener());
}

function newId(): string {
  return randomId().slice(0, 16);
}

function coverOf(card: Card): Pick<Summary, 'coverMediaId' | 'coverSrc' | 'coverKind'> | null {
  if (card.job && card.job.status !== 'succeeded') return null;
  if (card.mediaId) return { coverMediaId: card.mediaId, coverKind: card.kind };
  const src = card.src || '';
  const lasting =
    src.startsWith('/assets/') ||
    (src.startsWith('https://') && !card.remoteTemporary && src.length <= 2048);
  return lasting ? { coverSrc: src, coverKind: card.kind } : null;
}

/** What the lobby shows for a project, worked out from its contents. */
export function summarizeProject(project: Pick<ProjectState, 'title' | 'cards' | 'sequence'>) {
  const cards = project.cards.filter(card => !card.sessionOnly);
  const byId = new Map(cards.map(card => [card.id, card]));
  const shots = project.sequence.filter(shot => byId.has(shot.cardId));
  const candidates = [...shots.map(shot => byId.get(shot.cardId)!), ...cards.slice().reverse()];
  let cover: ReturnType<typeof coverOf> = null;
  for (const card of candidates) if ((cover = coverOf(card))) break;
  const summary: Summary = {
    title: project.title || DEFAULT_PROJECT_TITLE,
    cardCount: cards.length,
    shotCount: shots.length,
    durationSeconds: shots.reduce((total, shot) => total + finite(shot.duration), 0),
    ...cover,
  };
  return summary;
}

/**
 * Before projects there was one workspace. On the first start without an index it becomes a
 * project (a copy; the old keys stay as a backup). Returns the index that was stored.
 */
function migrateLegacyWorkspace(): string {
  const index: ProjectIndex = { version: 1, projects: [] };
  let after: Promise<unknown> | undefined;
  const legacy = readStoredValue(PROJECT_STORAGE_KEY);
  const entry = legacy ? legacyEntry(legacy) : null;
  if (entry) {
    const keys = {
      project: `frameout-project-${entry.id}`,
      checkpoints: `frameout-checkpoints-${entry.id}`,
    };
    const checkpoints = readStoredValue(CHECKPOINTS_STORAGE_KEY);
    try {
      const writes = [writeStoredValue(keys.project, legacy!)];
      if (checkpoints) writes.push(writeStoredValue(keys.checkpoints, checkpoints));
      // Desktop: list the project only once its copy is on disk.
      after = Promise.all(writes);
    } catch {
      // Browser storage is full: keep using the old keys instead of copying them.
      removeStoredValue(keys.project);
      entry.storage = 'legacy';
    }
    index.projects.push(entry);
    index.lastOpenedId = entry.id;
  }
  const raw = JSON.stringify(index);
  storeIndex(raw, after);
  return raw;
}

function legacyEntry(raw: string): StoredProject | null {
  let saved: Partial<ProjectState> | null;
  try {
    saved = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!saved || saved.version !== 1 || !Array.isArray(saved.cards)) return null;
  const project = restoreProject(saved);
  let checkpoints = Array.isArray(saved.checkpoints) && saved.checkpoints.length > 0;
  try {
    const separate = JSON.parse(readStoredValue(CHECKPOINTS_STORAGE_KEY) || 'null');
    checkpoints ||= Array.isArray(separate) && separate.length > 0;
  } catch {
    /* Damaged versions alone do not make a project. */
  }
  const used =
    project.cards.length > 0 ||
    project.sequence.length > 0 ||
    project.title !== DEFAULT_PROJECT_TITLE ||
    checkpoints;
  if (!used) return null;
  const now = Date.now();
  return { id: newId(), createdAt: now, updatedAt: now, ...summarizeProject(project) };
}

export function listProjects(): ProjectSummary[] {
  return readIndex().active;
}

export function listDeletedProjects(): ProjectSummary[] {
  return readIndex().deleted;
}

/** The project with this id, including deleted ones. */
export function findProject(id: string): ProjectSummary | undefined {
  return findStored(id);
}

export function createProject(title?: string): ProjectSummary {
  const now = Date.now();
  const entry: ProjectSummary = {
    id: newId(),
    title: normalizeProjectTitle(title ?? ''),
    createdAt: now,
    updatedAt: now,
    cardCount: 0,
    shotCount: 0,
    durationSeconds: 0,
  };
  const project = serializeProject({ ...initialState(), title: entry.title });
  void writeStoredValue(projectDataKeys(entry.id).project, JSON.stringify(project))?.catch(
    () => {},
  );
  changeIndex(index => {
    index.projects.push({ ...entry });
  });
  return entry;
}

/** Renames in the list; an open studio picks the new name up through subscribeProjects. */
export function renameProject(id: string, title: string): void {
  const value = normalizeProjectTitle(title);
  changeIndex(index => {
    const entry = index.projects.find(item => item.id === id);
    if (!entry || entry.title === value) return false;
    entry.title = value;
  });
}

export function deleteProject(id: string): void {
  changeIndex(index => {
    const entry = index.projects.find(item => item.id === id);
    if (!entry || entry.deletedAt !== undefined) return false;
    entry.deletedAt = Date.now();
    if (index.lastOpenedId === id) delete index.lastOpenedId;
  });
}

export function restoreDeletedProject(id: string): void {
  changeIndex(index => {
    const entry = index.projects.find(item => item.id === id);
    if (!entry || entry.deletedAt === undefined) return false;
    delete entry.deletedAt;
  });
}

/** Permanently drops projects deleted more than 30 days ago. Media files are shared and stay. */
export function purgeDeletedProjects(now = Date.now()): void {
  const expired = readIndex().index.projects.filter(
    entry => entry.deletedAt !== undefined && now - entry.deletedAt > DELETED_PROJECT_RETENTION_MS,
  );
  if (!expired.length) return;
  const keys = expired.map(entry =>
    entry.storage === 'legacy' ? null : projectDataKeys(entry.id),
  );
  const ids = new Set(expired.map(entry => entry.id));
  changeIndex(index => {
    index.projects = index.projects.filter(entry => !ids.has(entry.id));
  });
  // The pre-project keys are a backup and are never removed.
  for (const key of keys) {
    if (!key) continue;
    void removeStoredValue(key.project)?.catch(() => {});
    void removeStoredValue(key.checkpoints)?.catch(() => {});
  }
}

export function subscribeProjects(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === PROJECTS_INDEX_KEY || event.key === null) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** Desktop: loads the project's files so the studio can read them synchronously. */
export async function prepareProject(id: string): Promise<void> {
  if (!isDesktop()) return;
  const keys = projectDataKeys(id);
  await loadDesktopKeys([keys.project, keys.checkpoints], (key, value) => {
    if (key !== keys.project) return;
    let saved;
    try {
      saved = JSON.parse(value);
    } catch {
      saved = null;
    }
    if (saved?.version !== 1 || !Array.isArray(saved.cards) || !Array.isArray(saved.sequence))
      throw new Error('项目文件格式无法读取');
  });
}

export function lastOpenedProjectId(): string | null {
  const { index } = readIndex();
  const entry = index.projects.find(item => item.id === index.lastOpenedId);
  return entry && entry.deletedAt === undefined ? entry.id : null;
}

export function markProjectOpened(id: string): void {
  changeIndex(index => {
    if (index.lastOpenedId === id || !index.projects.some(entry => entry.id === id)) return false;
    index.lastOpenedId = id;
  });
}

/**
 * Called after the studio saves: refreshes the list entry from the contents. `contentChanged`
 * moves the project to the top of the list; opening or panning does not.
 */
export function recordProjectSave(
  id: string,
  project: Pick<ProjectState, 'title' | 'cards' | 'sequence'>,
  contentChanged: boolean,
): void {
  const summary = summarizeProject(project);
  try {
    changeIndex(index => {
      const entry = index.projects.find(item => item.id === id);
      if (!entry) return false;
      let changed = contentChanged;
      for (const field of SUMMARY_FIELDS) {
        if (entry[field] === summary[field]) continue;
        changed = true;
        if (summary[field] === undefined) delete entry[field];
        else Object.assign(entry, { [field]: summary[field] });
      }
      if (contentChanged) entry.updatedAt = Math.max(Date.now(), entry.updatedAt + 1);
      return changed;
    });
  } catch {
    /* The list entry is a summary; the project itself was saved. */
  }
}
