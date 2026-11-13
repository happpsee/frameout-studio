// Desktop development: the window loads the Vite dev server (`pnpm dev:web`), so
// page edits hot-reload; main and preload are rebuilt on change and Electron restarts.
// /api requests go through Vite's proxy to `pnpm dev:server`, not the bundled server.
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { context, type Plugin } from 'esbuild';
import { BUNDLES } from './bundles.ts';

const root = path.resolve(import.meta.dirname, '..');
const devUrl = process.env.FRAMEOUT_DEV_URL || 'http://127.0.0.1:5173';
// Keep development data apart from the real projects of the installed app.
const userData = process.env.FRAMEOUT_USER_DATA_DIR || path.join(root, '.dev-data');
const electronPath = createRequire(import.meta.url)('electron') as string;
const DEV_SERVER_WAIT_MS = 30_000;
const QUIT_GRACE_MS = 5_000;

async function waitForDevServer(): Promise<void> {
  const deadline = Date.now() + DEV_SERVER_WAIT_MS;
  let lastStatus = 0;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(devUrl);
      if (response.ok) return;
      lastStatus = response.status;
    } catch {
      // Not up yet.
    }
    await sleep(500);
  }
  // Something answers but not with the page: usually another process on the port.
  if (lastStatus) {
    const port = new URL(devUrl).port;
    throw new Error(
      `${devUrl} 有程序在响应，但返回 HTTP ${lastStatus}，不是帧外的页面。` +
        `用 lsof -i :${port} 查看占用端口的进程。`,
    );
  }
  throw new Error(`连不上 ${devUrl}，请先在另一个终端运行 pnpm dev:web`);
}

let electron: ChildProcess | undefined;
let restarting = false;

function startElectron(): void {
  const child = spawn(electronPath, ['.'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, FRAMEOUT_DEV_URL: devUrl, FRAMEOUT_USER_DATA_DIR: userData },
  });
  electron = child;
  // Quitting the app ends the dev session; a restart for a rebuild does not.
  child.once('exit', code => {
    if (!restarting && electron === child) process.exit(code ?? 0);
  });
}

async function stopElectron(): Promise<void> {
  const child = electron;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  // SIGTERM lets the app save the open project before quitting.
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), QUIT_GRACE_MS);
  await exited;
  clearTimeout(timer);
}

let restartTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleRestart(): void {
  // Several bundles can finish together; restart once.
  clearTimeout(restartTimer);
  restartTimer = setTimeout(async () => {
    console.log('[dev:desktop] 主进程或 preload 已更新，重启 Electron');
    restarting = true;
    await stopElectron();
    restarting = false;
    startElectron();
  }, 100);
}

// watch() starts with a build of its own; only builds after that first one restart Electron.
function restartAfterFirstBuild(onFirstBuild: () => void): Plugin {
  let built = false;
  return {
    name: 'restart-electron',
    setup(build) {
      build.onEnd(result => {
        if (result.errors.length) return;
        if (built) scheduleRestart();
        else {
          built = true;
          onFirstBuild();
        }
      });
    },
  };
}

const firstBuilds: Promise<void>[] = [];
const contexts = await Promise.all(
  BUNDLES.map(options => {
    let done!: () => void;
    firstBuilds.push(new Promise<void>(resolve => (done = resolve)));
    return context({ ...options, plugins: [restartAfterFirstBuild(done)] });
  }),
);
await Promise.all(contexts.map(bundle => bundle.watch()));
await Promise.all(firstBuilds);
await waitForDevServer();
console.log(`[dev:desktop] 页面来自 ${devUrl}，数据目录 ${userData}`);
startElectron();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    restarting = true;
    await stopElectron();
    await Promise.all(contexts.map(bundle => bundle.dispose()));
    process.exit(0);
  });
}
