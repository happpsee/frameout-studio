// Packages the built desktop app (dist/) and web UI into a local macOS .app.
// Run `pnpm build:desktop` from the repository root, which builds everything first.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { packager } from '@electron/packager';

if (process.platform !== 'darwin') throw new Error('请在 macOS 上构建帧外桌面应用');

const root = path.resolve(import.meta.dirname, '..');
const web = path.resolve(root, '..', 'web');
const { version, main } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string; main: string };
// The catalog/workspace specifier in package.json is not a version; ask the installed package.
const electronVersion = (createRequire(import.meta.url)('electron/package.json') as { version: string }).version;
const work = mkdtempSync(path.join(tmpdir(), 'frameout-desktop-'));
const appName = '帧外';
const appDir = path.join(work, 'app');
const iconset = path.join(work, 'Frameout.iconset');
const icon = path.join(work, 'Frameout.icns');

function run(command: string, args: string[]): void {
  execFileSync(command, args, { cwd: root, stdio: 'inherit' });
}

for (const file of ['dist/main.cjs', 'dist/preload.cjs', 'dist/server.cjs']) {
  if (!existsSync(path.join(root, file))) throw new Error(`缺少 ${file}，请先运行 pnpm build:desktop`);
}
if (!existsSync(path.join(web, 'dist/index.html'))) throw new Error('缺少已构建的前端文件，请先运行 pnpm build:desktop');

try {
  mkdirSync(iconset);
  const svg = path.join(web, 'public/assets/favicon.svg');
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const pixels = String(size * scale);
      const filename = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`;
      run('sips', ['-s', 'format', 'png', '-z', pixels, pixels, svg, '--out', path.join(iconset, filename)]);
    }
  }
  run('iconutil', ['-c', 'icns', iconset, '-o', icon]);

  // dist/ holds self-contained bundles, so the app ships no node_modules.
  mkdirSync(appDir);
  cpSync(path.join(root, 'dist'), path.join(appDir, 'dist'), { recursive: true });
  writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({ name: 'frameout', version, main }));
  cpSync(path.join(web, 'dist'), path.join(work, 'frontend'), { recursive: true });

  const bundles = await packager({
    dir: appDir,
    out: path.join(root, 'release'),
    name: appName,
    executableName: 'FRAMEOUT',
    appBundleId: 'studio.frameout.desktop',
    electronVersion,
    electronZipDir: process.env.FRAMEOUT_ELECTRON_ZIP_DIR,
    platform: 'darwin',
    arch: process.arch as 'arm64' | 'x64',
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
