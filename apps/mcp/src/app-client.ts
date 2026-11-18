// Talks to the running frameout desktop app. Where it listens and the token it accepts are in
// agent.json in the app's data folder, rewritten on every launch (docs/architecture/agent-plugin.md).
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** The app's data folder: FRAMEOUT_USER_DATA_DIR if set, as the app itself does. */
export function agentFile(env: NodeJS.ProcessEnv = process.env, platform = process.platform) {
  if (env.FRAMEOUT_USER_DATA_DIR) return path.join(env.FRAMEOUT_USER_DATA_DIR, 'agent.json');
  const appData =
    platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support')
      : platform === 'win32'
        ? (env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'))
        : (env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'));
  return path.join(appData, 'FRAMEOUT', 'agent.json');
}

/** An error worth showing the agent as is: what happened and what to do. */
export class AppError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

async function connection() {
  try {
    const { url, token } = JSON.parse(await fs.readFile(agentFile(), 'utf8')) as {
      url: string;
      token: string;
    };
    return { url: new URL(url), token };
  } catch {
    throw new AppError('APP_NOT_RUNNING', '没有找到正在运行的帧外桌面版，请先打开帧外');
  }
}

async function request(target: string, init: RequestInit) {
  const { url, token } = await connection();
  let response: Response;
  try {
    response = await fetch(new URL(target, url), {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${token}` },
    });
  } catch {
    throw new AppError('APP_NOT_RUNNING', '连不上帧外，请确认帧外桌面版正在运行');
  }
  const body = (await response.json().catch(() => ({}))) as {
    result?: unknown;
    fileId?: string;
    error?: { code?: string; message?: string };
  };
  if (!response.ok)
    throw new AppError(
      body.error?.code ?? 'FAILED',
      body.error?.message ?? `请求失败（${response.status}）`,
    );
  return body;
}

/** Runs one command in the open project and returns its answer. */
export async function call(name: string, args: Record<string, unknown> = {}) {
  const body = await request('/api/agent/call', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, args }),
  });
  return body.result;
}

/** Hands a file to the app; the returned id is what import_media takes. */
export async function upload(data: Buffer, type: string) {
  const body = await request('/api/agent/files', {
    method: 'POST',
    headers: { 'content-type': type },
    body: new Uint8Array(data),
  });
  if (!body.fileId) throw new AppError('FAILED', '文件上传失败');
  return body.fileId;
}

/** Fetches a file the app handed over (an exported film), once. */
export async function download(fileId: string) {
  const { url, token } = await connection();
  const response = await fetch(new URL(`/api/agent/files/${encodeURIComponent(fileId)}`, url), {
    headers: { authorization: `Bearer ${token}` },
  }).catch(() => {
    throw new AppError('APP_NOT_RUNNING', '连不上帧外，请确认帧外桌面版正在运行');
  });
  if (!response.ok) throw new AppError('NOT_FOUND', '成片文件已过期，请重新导出');
  return Buffer.from(await response.arrayBuffer());
}
