import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('..', import.meta.url));
const python = path.join(root, 'backend', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
if (!existsSync(python)) {
  console.error('请先安装后端依赖：python3 -m venv backend/.venv，然后 backend/.venv/bin/python -m pip install -e "./backend[dev]"');
  process.exit(1);
}
const commands = [
  [python, ['-m', 'uvicorn', 'app.main:app', '--app-dir', 'backend', '--host', '127.0.0.1', '--port', '8000', '--reload', '--reload-dir', 'backend/app']],
  [process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--config', 'frontend/vite.config.ts', '--host', '127.0.0.1', 'frontend']],
];
const children = commands.map(([command, args]) => spawn(command, args, { cwd: root, stdio: 'inherit', detached: process.platform !== 'win32' }));
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.pid) continue;
    try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM'); else child.kill('SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') console.error(error.message); }
  }
  process.exitCode = code;
}
for (const child of children) {
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', code => { if (!stopping) stop(code || 0); });
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
