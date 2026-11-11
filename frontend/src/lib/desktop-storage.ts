interface DesktopBridge {
  platform: string;
  storage: {
    read(key: string): Promise<ArrayBuffer | null>;
    write(key: string, data: ArrayBuffer): Promise<void>;
  };
  onBeforeClose(callback: () => Promise<void>): () => void;
  openTemporaryDownload(url: string): Promise<void>;
}

declare global {
  interface Window { frameoutDesktop?: DesktopBridge }
}

export const PROJECT_STORAGE_KEY = 'frameout-studio-v1';
export const PREFERENCES_KEY = 'frameout-ai-preferences-v1';
export const GENERATION_MODE_KEY = 'frameout-generation-mode';
export const DESKTOP_INTRO_KEY = 'frameout-desktop-intro-v1';
const settings = [PROJECT_STORAGE_KEY, PREFERENCES_KEY, GENERATION_MODE_KEY, DESKTOP_INTRO_KEY];
const desktopValues = new Map<string, string>();
const pendingWrites = new Map<string, Promise<void>>();

export async function loadDesktopStorage(): Promise<void> {
  const desktop = window.frameoutDesktop;
  if (!desktop) return;
  const values = await Promise.all(settings.map(async key => {
    const bytes = await desktop.storage.read(key);
    return [key, bytes ? new TextDecoder().decode(bytes) : null] as const;
  }));
  for (const [key, value] of values) {
    if (value === null) { desktopValues.delete(key); continue; }
    if (key === PROJECT_STORAGE_KEY) {
      const saved = JSON.parse(value);
      if (saved?.version !== 1 || !Array.isArray(saved.cards) || !Array.isArray(saved.sequence)) throw new Error('项目文件格式无法读取');
    }
    desktopValues.set(key, value);
  }
}

export function readStoredValue(key: string): string | null {
  return window.frameoutDesktop ? desktopValues.get(key) ?? null : localStorage.getItem(key);
}

export function writeStoredValue(key: string, value: string): void | Promise<void> {
  const desktop = window.frameoutDesktop;
  if (!desktop) { localStorage.setItem(key, value); return; }
  desktopValues.set(key, value);
  const previous = pendingWrites.get(key);
  const write = (previous ?? Promise.resolve()).catch(() => {}).then(() => desktop.storage.write(key, new TextEncoder().encode(value).buffer));
  pendingWrites.set(key, write);
  const forget = () => { if (pendingWrites.get(key) === write) pendingWrites.delete(key); };
  void write.then(forget, forget);
  return write;
}

export async function flushDesktopStorage(): Promise<void> {
  await Promise.all(pendingWrites.values());
}
