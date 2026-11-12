import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, shell, utilityProcess,
  type IpcMainEvent, type IpcMainInvokeEvent, type MenuItemConstructorOptions, type UtilityProcess,
} from 'electron';
import { DESKTOP_CHANNELS as CHANNELS } from '@frameout/shared';
import { createSecrets } from './secrets.ts';
import { createStorage } from './storage.ts';
import type { ServerMessage } from './server-process.ts';

app.setName('帧外');

const userData = path.resolve(process.env.FRAMEOUT_USER_DATA_DIR || path.join(app.getPath('appData'), 'FRAMEOUT'));
fs.mkdirSync(userData, { recursive: true, mode: 0o700 });
app.setPath('userData', userData);

const storage = createStorage(path.join(userData, 'storage'));
// Kept apart from storage/ so the generic storage IPC cannot read or overwrite it.
const secrets = createSecrets(path.join(userData, 'secrets'), safeStorage);
const PROVIDER_CONSOLES = new Set(['platform.openai.com', 'console.volcengine.com']);
const CLOSE_TIMEOUT = 30_000;
const STARTUP_TIMEOUT = 30_000;

interface PendingClose {
  token: string;
  quitting: boolean;
  finish: (saved: boolean) => void;
}

let mainWindow: BrowserWindow | undefined;
let backend: UtilityProcess | undefined;
let origin: string | undefined;
let pendingClose: PendingClose | undefined;
let closingWindow = false;
let quitApproved = false;

function localOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('帧外服务必须使用本机回环地址');
  }
  return url.origin;
}

function isTrusted(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  if (!mainWindow || event.sender !== mainWindow.webContents || !event.senderFrame || event.senderFrame.parent) return false;
  const value = event.senderFrame.url;
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return url.origin === origin && url.pathname === '/';
}

// The API server runs in a utility process (Electron's own Node sidecar), so a
// large upstream JSON response never blocks the main process or the window.
function startBackend(): Promise<string> {
  // dist/ → apps/web/dist in development; bundled beside the app when packaged.
  const frontend = app.isPackaged ? path.join(process.resourcesPath, 'frontend') : path.resolve(__dirname, '..', '..', 'web', 'dist');
  if (!fs.existsSync(path.join(frontend, 'index.html'))) throw new Error('缺少已构建的前端文件');

  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(path.join(__dirname, 'server.cjs'), [], {
      cwd: userData,
      env: { ...process.env, FRAMEOUT_FRONTEND_DIST: frontend },
      serviceName: '帧外服务',
      stdio: ['ignore', 'inherit', 'pipe'],
    });
    backend = child;
    let ready = false;
    let failed = false;
    let exited = false;
    let errors = '';
    const timeout = setTimeout(() => fail(new Error('等待帧外服务启动超时')), STARTUP_TIMEOUT);
    function fail(error: unknown) {
      if (ready || failed) return;
      failed = true;
      clearTimeout(timeout);
      if (!exited) child.kill();
      if (errors) console.error(errors.trim());
      reject(error);
    }
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (text: string) => { errors = (errors + text).slice(-16_384); });
    child.once('exit', code => {
      exited = true;
      if (backend === child) backend = undefined;
      if (!ready) {
        fail(new Error(`帧外服务启动失败（${code}）`));
      } else if (!quitApproved) {
        if (errors) console.error(errors.trim());
        dialog.showErrorBox('帧外服务已停止', '请关闭并重新打开帧外。');
      }
    });
    child.on('message', (message: ServerMessage | undefined) => {
      if (ready || failed || message?.type !== 'ready') return;
      try {
        const url = localOrigin(message.url);
        ready = true;
        clearTimeout(timeout);
        resolve(url);
      } catch (error) {
        fail(error);
      }
    });
  });
}

async function requestClose(window: BrowserWindow, quitting: boolean): Promise<void> {
  if (pendingClose) {
    pendingClose.quitting ||= quitting;
    return;
  }
  const state: PendingClose = { token: randomUUID(), quitting, finish: () => {} };
  pendingClose = state;
  const saved = await new Promise<boolean>(resolve => {
    const timeout = setTimeout(() => state.finish(false), CLOSE_TIMEOUT);
    state.finish = value => { clearTimeout(timeout); resolve(value); };
    if (window.webContents.isDestroyed() || window.webContents.isLoadingMainFrame() || window.webContents.isCrashed()) {
      state.finish(false);
    } else {
      window.webContents.send(CHANNELS.prepareClose, state.token);
    }
  });
  if (!saved && !window.isDestroyed()) {
    const result = await dialog.showMessageBox(window, {
      type: 'warning', title: '项目还未保存', message: '帧外未能保存最新更改。',
      buttons: ['返回帧外', '仍然关闭'], defaultId: 0, cancelId: 0,
    });
    if (result.response !== 1) {
      pendingClose = undefined;
      return;
    }
  }
  pendingClose = undefined;
  if (state.quitting) {
    quitApproved = true;
    app.quit();
  } else if (!window.isDestroyed()) {
    closingWindow = true;
    window.close();
  }
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440, height: 920, minWidth: 980, minHeight: 640,
    title: '帧外 FRAMEOUT', backgroundColor: '#151613', show: false,
    ...(process.platform === 'darwin' ? {
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 16, y: 21 },
    } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
    },
  });
  mainWindow = window;
  window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const preventExternalNavigation = (event: Electron.Event<{ url: string }>) => {
    if (!URL.canParse(event.url) || new URL(event.url).origin !== origin) event.preventDefault();
  };
  window.webContents.on('will-navigate', preventExternalNavigation);
  window.webContents.on('will-redirect', preventExternalNavigation);
  window.on('close', event => {
    if (quitApproved || closingWindow) return;
    event.preventDefault();
    void requestClose(window, false);
  });
  window.on('closed', () => { mainWindow = undefined; closingWindow = false; });
  window.loadURL(`${origin}/`).catch((error: Error) => {
    if (window.isDestroyed()) return;
    quitApproved = true;
    dialog.showErrorBox('无法打开帧外', error.message);
    app.quit();
  });
}

function installMenu(): void {
  const openData: MenuItemConstructorOptions = {
    label: '打开数据文件夹',
    async click() {
      const error = await shell.openPath(userData);
      if (error) dialog.showErrorBox('无法打开数据文件夹', error);
    },
  };
  const appMenu: MenuItemConstructorOptions = process.platform === 'darwin'
    ? { label: app.name, submenu: [
      { role: 'about' }, openData, { type: 'separator' }, { role: 'services' }, { type: 'separator' },
      { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' },
    ] }
    : { label: '文件', submenu: [openData, { type: 'separator' }, { role: 'quit' }] };
  Menu.setApplicationMenu(Menu.buildFromTemplate([appMenu, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]));
}

function trusted<A extends unknown[], R>(message: string, handler: (...args: A) => R) {
  return (event: IpcMainInvokeEvent, ...args: A): R => {
    if (!isTrusted(event)) throw new Error(message);
    return handler(...args);
  };
}

function externalUrl(value: unknown, message: string): URL {
  if (typeof value !== 'string' || !URL.canParse(value)) throw new Error(message);
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error(message);
  return url;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Arguments arrive from the renderer untyped; storage and secrets validate them.
  ipcMain.handle(CHANNELS.storageRead, trusted('Untrusted storage request', (key: unknown) => storage.read(key)));
  ipcMain.handle(CHANNELS.storageWrite, trusted('Untrusted storage request', (key: unknown, data: unknown) => storage.write(key, data)));
  ipcMain.handle(CHANNELS.secretsAvailable, trusted('Untrusted secrets request', () => secrets.available()));
  ipcMain.handle(CHANNELS.secretsRead, trusted('Untrusted secrets request', () => secrets.read()));
  ipcMain.handle(CHANNELS.secretsWrite, trusted('Untrusted secrets request', (provider: unknown, key: unknown) => secrets.write(provider, key)));
  ipcMain.handle(CHANNELS.openTemporaryDownload, trusted('Invalid download request', (value: unknown) =>
    shell.openExternal(externalUrl(value, 'Download link must use HTTPS').href)));
  ipcMain.handle(CHANNELS.openProviderConsole, trusted('Invalid console link', (value: unknown) => {
    const url = externalUrl(value, 'Unknown provider console');
    if (!PROVIDER_CONSOLES.has(url.hostname)) throw new Error('Unknown provider console');
    return shell.openExternal(url.href);
  }));
  ipcMain.on(CHANNELS.closeReady, (event, token: unknown, saved: unknown) => {
    const pending = pendingClose;
    if (isTrusted(event) && pending && pending.token === token) pending.finish(saved === true);
  });

  app.on('second-instance', () => {
    if (!mainWindow && origin) createWindow();
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.focus();
  });
  app.on('activate', () => { if (!mainWindow && origin) createWindow(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', event => {
    if (quitApproved || !mainWindow) return;
    event.preventDefault();
    void requestClose(mainWindow, true);
  });
  app.on('will-quit', () => {
    quitApproved = true;
    backend?.kill();
  });
  app.whenReady().then(async () => {
    installMenu();
    origin = !app.isPackaged && process.env.FRAMEOUT_DEV_URL ? localOrigin(process.env.FRAMEOUT_DEV_URL) : await startBackend();
    if (!quitApproved) createWindow();
  }).catch((error: Error) => {
    quitApproved = true;
    dialog.showErrorBox('无法启动帧外', error.message);
    app.quit();
  });
}
