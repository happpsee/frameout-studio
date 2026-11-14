import { desktopBridge, isDesktop } from '../../platform';

/** The single workspace from before projects; kept as a read-only backup after migration. */
export const PROJECT_STORAGE_KEY = 'frameout-studio-v1';
export const PREFERENCES_KEY = 'frameout-ai-preferences-v1';
export const GENERATION_MODE_KEY = 'frameout-generation-mode';
/** Set to 'seen' once the introduction has been shown (desktop and web). */
export const DESKTOP_INTRO_KEY = 'frameout-desktop-intro-v1';
export const EXPORT_PREFERENCES_KEY = 'frameout-export-preferences-v1';
export const THEME_KEY = 'frameout-theme';
// Version snapshots change rarely, so they are stored apart from the frequently autosaved project.
export const CHECKPOINTS_STORAGE_KEY = 'frameout-studio-checkpoints-v1';
/** The project list (项目大厅). Each project's data lives under its own keys, see lib/projects.ts. */
export const PROJECTS_INDEX_KEY = 'frameout-projects-v1';
// Read before the first render. Per-project keys are loaded later, by loadDesktopKeys.
const settings = [
  PROJECTS_INDEX_KEY,
  PROJECT_STORAGE_KEY,
  CHECKPOINTS_STORAGE_KEY,
  PREFERENCES_KEY,
  GENERATION_MODE_KEY,
  DESKTOP_INTRO_KEY,
  EXPORT_PREFERENCES_KEY,
  THEME_KEY,
];
const desktopValues = new Map<string, string>();
const loadedKeys = new Set<string>();
const pendingWrites = new Map<string, Promise<void>>();

async function readDesktopValue(key: string): Promise<string | null> {
  const bytes = await desktopBridge()!.storage.read(key);
  return bytes ? new TextDecoder().decode(bytes) : null;
}

export async function loadDesktopStorage(): Promise<void> {
  if (!desktopBridge()) return;
  desktopValues.clear();
  loadedKeys.clear();
  const values = await Promise.all(
    settings.map(async key => [key, await readDesktopValue(key)] as const),
  );
  for (const [key, value] of values) {
    loadedKeys.add(key);
    // An empty file is a removed value (the storage bridge cannot delete files).
    if (value) desktopValues.set(key, value);
  }
}

/**
 * Desktop: reads keys that are not in memory yet, so readStoredValue can return them.
 * `check` may throw to refuse a damaged value; nothing is kept in memory then.
 */
export async function loadDesktopKeys(
  keys: readonly string[],
  check?: (key: string, value: string) => void,
): Promise<void> {
  if (!desktopBridge()) return;
  const missing = keys.filter(key => !loadedKeys.has(key) && !desktopValues.has(key));
  const values = await Promise.all(
    missing.map(async key => {
      await pendingWrites.get(key)?.catch(() => {});
      return [key, await readDesktopValue(key)] as const;
    }),
  );
  // A value written while reading is newer than the file.
  const fresh = values.filter(([key]) => !loadedKeys.has(key));
  for (const [key, value] of fresh) if (value) check?.(key, value);
  for (const [key, value] of fresh) {
    loadedKeys.add(key);
    if (value) desktopValues.set(key, value);
  }
}

export function readStoredValue(key: string): string | null {
  return isDesktop() ? (desktopValues.get(key) ?? null) : localStorage.getItem(key);
}

/**
 * Stores a value. On desktop it is readable at once and written to disk in order; with `after`,
 * the disk write waits for that promise and is skipped if it fails.
 */
export function writeStoredValue(
  key: string,
  value: string,
  after?: Promise<unknown>,
): void | Promise<void> {
  const desktop = desktopBridge();
  if (!desktop) {
    localStorage.setItem(key, value);
    return;
  }
  desktopValues.set(key, value);
  loadedKeys.add(key);
  const previous = pendingWrites.get(key);
  const ready = (previous ?? Promise.resolve()).catch(() => {});
  const write = (after ? ready.then(() => after) : ready).then(() =>
    desktop.storage.write(key, new TextEncoder().encode(value).buffer),
  );
  pendingWrites.set(key, write);
  const forget = () => {
    if (pendingWrites.get(key) === write) pendingWrites.delete(key);
  };
  void write.then(forget, forget);
  return write;
}

/** Removes a value; on desktop the file is emptied, which reads back as no value. */
export function removeStoredValue(key: string): void | Promise<void> {
  if (!isDesktop()) {
    localStorage.removeItem(key);
    return;
  }
  const write = writeStoredValue(key, '');
  desktopValues.delete(key);
  return write;
}

export async function flushDesktopStorage(): Promise<void> {
  await Promise.all(pendingWrites.values());
}
