import { contextBridge, ipcRenderer } from 'electron';
import { DESKTOP_CHANNELS as CHANNELS, type DesktopBridge } from '@frameout/shared';

const closeHandlers = new Set<() => Promise<void>>();

ipcRenderer.on(CHANNELS.prepareClose, async (_event, token: string) => {
  const results = await Promise.allSettled([...closeHandlers].map(handler => Promise.resolve().then(handler)));
  ipcRenderer.send(CHANNELS.closeReady, token, results.every(result => result.status === 'fulfilled'));
});

const bridge: DesktopBridge = {
  platform: process.platform,
  storage: {
    read: key => ipcRenderer.invoke(CHANNELS.storageRead, key),
    write: (key, data) => ipcRenderer.invoke(CHANNELS.storageWrite, key, data),
  },
  openTemporaryDownload: url => ipcRenderer.invoke(CHANNELS.openTemporaryDownload, url),
  openProviderConsole: url => ipcRenderer.invoke(CHANNELS.openProviderConsole, url),
  secrets: {
    available: () => ipcRenderer.invoke(CHANNELS.secretsAvailable),
    read: () => ipcRenderer.invoke(CHANNELS.secretsRead),
    write: (provider, key) => ipcRenderer.invoke(CHANNELS.secretsWrite, provider, key),
  },
  onBeforeClose(handler) {
    closeHandlers.add(handler);
    return () => closeHandlers.delete(handler);
  },
};

contextBridge.exposeInMainWorld('frameoutDesktop', bridge);
