/** The API the Electron preload exposes to the page as `window.frameoutDesktop`. */
export interface DesktopBridge {
  platform: string;
  storage: {
    read(key: string): Promise<ArrayBuffer | null>;
    write(key: string, data: ArrayBuffer): Promise<void>;
  };
  onBeforeClose(callback: () => Promise<void>): () => void;
  openTemporaryDownload(url: string): Promise<void>;
  openProviderConsole(url: string): Promise<void>;
  /** Keys the user chose to remember, encrypted by the OS keychain in the main process. */
  secrets: {
    available(): Promise<boolean>;
    read(): Promise<Partial<Record<string, string>>>;
    write(provider: string, key: string | null): Promise<void>;
  };
}

/** IPC channels between the preload and the main process. */
export const DESKTOP_CHANNELS = {
  storageRead: 'frameout:storage:read',
  storageWrite: 'frameout:storage:write',
  openTemporaryDownload: 'frameout:open-temporary-download',
  openProviderConsole: 'frameout:open-provider-console',
  secretsAvailable: 'frameout:secrets:available',
  secretsRead: 'frameout:secrets:read',
  secretsWrite: 'frameout:secrets:write',
  prepareClose: 'frameout:prepare-close',
  closeReady: 'frameout:close-ready',
} as const;
