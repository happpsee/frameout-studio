const { contextBridge, ipcRenderer } = require('electron');

const closeHandlers = new Set();

ipcRenderer.on('frameout:prepare-close', async (_event, token) => {
  const results = await Promise.allSettled([...closeHandlers].map(handler => Promise.resolve().then(handler)));
  ipcRenderer.send('frameout:close-ready', token, results.every(result => result.status === 'fulfilled'));
});

contextBridge.exposeInMainWorld('frameoutDesktop', {
  platform: process.platform,
  storage: {
    read: key => ipcRenderer.invoke('frameout:storage:read', key),
    write: (key, data) => ipcRenderer.invoke('frameout:storage:write', key, data),
  },
  openTemporaryDownload: url => ipcRenderer.invoke('frameout:open-temporary-download', url),
  openProviderConsole: url => ipcRenderer.invoke('frameout:open-provider-console', url),
  secrets: {
    available: () => ipcRenderer.invoke('frameout:secrets:available'),
    read: () => ipcRenderer.invoke('frameout:secrets:read'),
    write: (provider, key) => ipcRenderer.invoke('frameout:secrets:write', provider, key),
  },
  onBeforeClose(handler) {
    closeHandlers.add(handler);
    return () => closeHandlers.delete(handler);
  },
});
