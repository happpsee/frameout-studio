import http from 'node:http';
import { expect, test } from 'vitest';
import { createApp } from '../app.ts';
import { createSettings } from '../config.ts';

const TOKEN = 'a'.repeat(64);

async function withServer(run: (base: string) => Promise<void>) {
  const app = createApp(createSettings({ agentToken: TOKEN }));
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${(server.address() as { port: number }).port}`);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

const call = (base: string, token: string) =>
  fetch(`${base}/api/agent/call`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'get_project', args: {} }),
  });

test('an agent needs the token, and gets an answer only while a window is open', async () => {
  await withServer(async base => {
    expect((await call(base, 'wrong')).status).toBe(401);
    expect((await call(base, TOKEN)).status).toBe(503);
  });
});

test("a call reaches the window and the window's answer comes back to the agent", async () => {
  await withServer(async base => {
    const origin = { origin: base };
    const events = await fetch(`${base}/api/agent/bridge/events`, { headers: origin });
    const reader = events.body!.getReader();
    const pending = call(base, TOKEN);
    // Read the stream until the command arrives, then answer it as the window would.
    let text = '';
    while (!text.includes('data: ')) text += new TextDecoder().decode((await reader.read()).value);
    const command = JSON.parse(text.slice(text.indexOf('data: ') + 6).split('\n')[0]);
    expect(command.name).toBe('get_project');
    await fetch(`${base}/api/agent/bridge/results/${command.id}`, {
      method: 'POST',
      headers: { ...origin, 'content-type': 'application/json' },
      body: JSON.stringify({ result: { title: '未命名项目' } }),
    });
    expect(await (await pending).json()).toEqual({ result: { title: '未命名项目' } });
    await reader.cancel();
  });
});

test('a film the window hands over reaches the agent with the token, once', async () => {
  await withServer(async base => {
    const posted = await fetch(`${base}/api/agent/bridge/files`, {
      method: 'POST',
      headers: { origin: base, 'content-type': 'video/mp4' },
      body: new Uint8Array([1, 2, 3]),
    });
    const { fileId } = (await posted.json()) as { fileId: string };
    const auth = { authorization: `Bearer ${TOKEN}` };
    expect((await fetch(`${base}/api/agent/files/${fileId}`)).status).toBe(401);
    const first = await fetch(`${base}/api/agent/files/${fileId}`, { headers: auth });
    expect([...new Uint8Array(await first.arrayBuffer())]).toEqual([1, 2, 3]);
    expect((await fetch(`${base}/api/agent/files/${fileId}`, { headers: auth })).status).toBe(404);
  });
});
