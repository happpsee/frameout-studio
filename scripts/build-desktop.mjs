import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';

if (process.platform !== 'darwin') throw new Error('请在 macOS 上构建帧外桌面应用');

const root = fileURLToPath(new URL('..', import.meta.url));
const { name, version, main, devDependencies } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const work = mkdtempSync(path.join(tmpdir(), 'frameout-desktop-'));
const appName = '帧外';
const appDir = path.join(work, 'app');
const iconset = path.join(work, 'Frameout.iconset');
const icon = path.join(work, 'Frameout.icns');

function run(command, args) {
  execFileSync(command, args, { cwd: root, stdio: 'inherit' });
}

try {
  mkdirSync(iconset);
  const svg = path.join(root, 'frontend/public/assets/favicon.svg');
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const pixels = String(size * scale);
      const filename = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`;
      run('sips', ['-s', 'format', 'png', '-z', pixels, pixels, svg, '--out', path.join(iconset, filename)]);
    }
  }
  run('iconutil', ['-c', 'icns', iconset, '-o', icon]);

  mkdirSync(appDir);
  // electron/storage.cjs requires ../utils/queue and the main process forks
  // ../server/desktop.cjs, so ship both beside electron.
  for (const dir of ['electron', 'utils', 'server']) {
    cpSync(path.join(root, dir), path.join(appDir, dir), { recursive: true, filter: source => !source.endsWith('.test.cjs') });
  }
  cpSync(path.join(root, 'frontend/dist'), path.join(work, 'frontend'), { recursive: true });
  writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({ name, version, main }));
  const bundles = await packager({
    dir: appDir,
    out: path.join(root, 'dist/desktop'),
    name: appName,
    executableName: 'FRAMEOUT',
    appBundleId: 'studio.frameout.desktop',
    electronVersion: devDependencies.electron,
    electronZipDir: process.env.FRAMEOUT_ELECTRON_ZIP_DIR,
    platform: 'darwin',
    arch: process.arch,
    asar: true,
    icon: [icon],
    extraResource: [path.join(work, 'frontend')],
    overwrite: true,
  });
  for (const bundle of bundles) {
    const app = path.join(bundle, `${appName}.app`);
    // This build is for local use. Sign the app and Chromium helpers together.
    run('codesign', ['--force', '--deep', '--sign', '-', app]);
    run('codesign', ['--verify', '--deep', '--strict', app]);
    console.log(app);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
