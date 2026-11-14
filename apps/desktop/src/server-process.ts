// Runs in Electron's utilityProcess: serves the bundled UI and the relay on a
// private loopback port, then reports the origin to the main process.
import http from 'node:http';
import { createApp, settingsFromEnv } from '@frameout/server';

export type ServerMessage = { type: 'ready'; url: string };

const HOST = '127.0.0.1';
const server = http.createServer();

server.listen(0, HOST, () => {
  const { port } = server.address() as { port: number };
  const origin = `http://${HOST}:${port}`;
  // Only requests addressed to the loopback host are served (DNS rebinding).
  const settings = { ...settingsFromEnv(), allowedHosts: [HOST] };
  server.on('request', createApp(settings));
  const message: ServerMessage = { type: 'ready', url: `${origin}/` };
  process.parentPort.postMessage(message);
});
