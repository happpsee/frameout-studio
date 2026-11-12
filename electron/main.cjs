const { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, shell, utilityProcess } = require('electron');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createStorage } = require('./storage.cjs');
const { createSecrets } = require('./secrets.cjs');

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

let mainWindow;
let backend;
let origin;
let pendingClose;
let closingWindow = false;
let quitApproved = false;

function localOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('帧外服务必须使用本机回环地址');
  }
  return url.origin;
}

function isTrusted(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents || !event.senderFrame || event.senderFrame.parent) return false;
  const value = event.senderFrame.url;
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return url.origin === origin && url.pathname === '/';
}

// The API server runs in a utility process (Electron's own Node sidecar), so a
// large upstream JSON response never blocks the main process or the window.
function startBackend() {
  const frontend = app.isPackaged ? path.join(process.resourcesPath, 'frontend') : path.resolve(__dirname, '..', 'frontend', 'dist');
  if (!fs.existsSync(path.join(frontend, 'index.html'))) throw new Error('缺少已构建的前端文件');

  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(path.join(__dirname, '..', 'server', 'desktop.cjs'), [], {
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
    function fail(error) {
      if (ready || failed) return;
      failed = true;
      clearTimeout(timeout);
      if (!exited) child.kill();
      if (errors) console.error(errors.trim());
      reject(error);
    }
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', text => { errors = (errors + text).slice(-16_384); });
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
    child.on('message', message => {
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

async function requestClose(window, quitting) {
  if (pendingClose) {
    pendingClose.quitting ||= quitting;
    return;
  }
  const state = { token: randomUUID(), quitting };
  pendingClose = state;
  const saved = await new Promise(resolve => {
    const timeout = setTimeout(() => state.finish(false), CLOSE_TIMEOUT);
    state.finish = value => { clearTimeout(timeout); resolve(value); };
    if (window.webContents.isDestroyed() || window.webContents.isLoadingMainFrame() || window.webContents.isCrashed()) {
      state.finish(false);
    } else {
      window.webContents.send('frameout:prepare-close', state.token);
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

function createWindow() {
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
  const preventExternalNavigation = event => {
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
  window.loadURL(`${origin}/`).catch(error => {
    if (window.isDestroyed()) return;
    quitApproved = true;
    dialog.showErrorBox('无法打开帧外', error.message);
    app.quit();
  });
}

function installMenu() {
  const openData = {
    label: '打开数据文件夹',
    async click() {
      const error = await shell.openPath(userData);
      if (error) dialog.showErrorBox('无法打开数据文件夹', error);
    },
  };
  const appMenu = process.platform === 'darwin'
    ? { label: app.name, submenu: [
      { role: 'about' }, openData, { type: 'separator' }, { role: 'services' }, { type: 'separator' },
      { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' },
    ] }
    : { label: '文件', submenu: [openData, { type: 'separator' }, { role: 'quit' }] };
  Menu.setApplicationMenu(Menu.buildFromTemplate([appMenu, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  for (const operation of ['read', 'write']) {
    ipcMain.handle(`frameout:storage:${operation}`, (event, ...args) => {
      if (!isTrusted(event)) throw new Error('Untrusted storage request');
      return storage[operation](...args);
    });
  }
  ipcMain.handle('frameout:open-temporary-download', (event, value) => {
    if (!isTrusted(event) || typeof value !== 'string' || !URL.canParse(value)) throw new Error('Invalid download request');
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Download link must use HTTPS');
    return shell.openExternal(url.href);
  });
  ipcMain.handle('frameout:secrets:available', event => {
    if (!isTrusted(event)) throw new Error('Untrusted secrets request');
    return secrets.available();
  });
  ipcMain.handle('frameout:secrets:read', event => {
    if (!isTrusted(event)) throw new Error('Untrusted secrets request');
    return secrets.read();
  });
  ipcMain.handle('frameout:secrets:write', (event, provider, key) => {
    if (!isTrusted(event)) throw new Error('Untrusted secrets request');
    return secrets.write(provider, key);
  });
  ipcMain.handle('frameout:open-provider-console', (event, value) => {
    if (!isTrusted(event) || typeof value !== 'string' || !URL.canParse(value)) throw new Error('Invalid console link');
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || !PROVIDER_CONSOLES.has(url.hostname)) throw new Error('Unknown provider console');
    return shell.openExternal(url.href);
  });
  ipcMain.on('frameout:close-ready', (event, token, saved) => {
    if (isTrusted(event) && pendingClose?.token === token) pendingClose.finish(saved === true);
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
  }).catch(error => {
    quitApproved = true;
    dialog.showErrorBox('无法启动帧外', error.message);
    app.quit();
  });
}
