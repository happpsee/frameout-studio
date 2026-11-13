// Frees a TCP port before a dev server starts: if a process from this repository
// is listening on it (usually a dev server left running), stop it. A process from
// anywhere else is left alone, so another project's server is never killed.
//
// Usage: node tools/free-port.mts <port>
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const repo = path.resolve(import.meta.dirname, '..');
const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('用法：node tools/free-port.mts <端口>');
  process.exit(2);
}

/** Runs a command and returns its output, or '' if it fails (lsof exits 1 when nothing matches). */
function output(command: string, args: string[]): string {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

function listeners(): number[] {
  return output('lsof', ['-t', '-nP', `-iTCP:${port}`, '-sTCP:LISTEN'])
    .split('\n')
    .filter(Boolean)
    .map(Number);
}

function describe(pid: number): { command: string; cwd: string } {
  const command = output('ps', ['-o', 'command=', '-p', String(pid)]).trim();
  const cwdLine = output('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'])
    .split('\n')
    .find(line => line.startsWith('n'));
  return { command, cwd: cwdLine?.slice(1) ?? '' };
}

const isInRepo = ({ command, cwd }: { command: string; cwd: string }) =>
  cwd === repo || cwd.startsWith(repo + path.sep) || command.includes(repo + path.sep);

async function waitUntilFree(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!listeners().length) return true;
    await sleep(200);
  }
  return !listeners().length;
}

const pids = listeners();
if (pids.length) {
  for (const pid of pids) {
    const info = describe(pid);
    if (!isInRepo(info)) {
      console.error(`端口 ${port} 被本项目之外的程序占用，不自动停止：PID ${pid} ${info.command}`);
      process.exit(1);
    }
  }
  for (const pid of pids) {
    console.log(`端口 ${port} 被本项目的旧进程占用，正在停止：PID ${pid} ${describe(pid).command}`);
    process.kill(pid, 'SIGTERM');
  }
  if (!(await waitUntilFree(3_000))) {
    for (const pid of listeners()) process.kill(pid, 'SIGKILL');
    if (!(await waitUntilFree(1_000))) {
      console.error(`端口 ${port} 仍被占用，请手动处理：lsof -i :${port}`);
      process.exit(1);
    }
  }
}
