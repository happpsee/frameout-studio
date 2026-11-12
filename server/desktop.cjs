'use strict';
// Desktop entry, run by Electron's utilityProcess: serves the bundled UI and the
// relay on a private loopback port, then reports the origin to the main process.

const http = require('node:http');
const { createApp } = require('./app.cjs');
const { settingsFromEnv } = require('./config.cjs');

const HOST = '127.0.0.1';
const server = http.createServer();

server.listen(0, HOST, () => {
  const origin = `http://${HOST}:${server.address().port}`;
  // Only the desktop window's own origin may call the relay; ignore any
  // FRAMEOUT_ALLOWED_ORIGINS inherited from the user's shell.
  const settings = { ...settingsFromEnv(), allowedOrigins: new Set([origin]), allowedHosts: [HOST] };
  server.on('request', createApp(settings));
  process.parentPort.postMessage({ type: 'ready', url: `${origin}/` });
});
