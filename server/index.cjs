'use strict';
// Web entry: serves the built frontend and /api on HOST:PORT (default 127.0.0.1:8000).

const http = require('node:http');
const { createApp } = require('./app.cjs');
const { settingsFromEnv } = require('./config.cjs');

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 8000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535');

const server = http.createServer(createApp(settingsFromEnv()));
server.listen(port, host, () => console.log(`帧外服务已启动：http://${host}:${port}`));

function shutdown() {
  server.close(() => process.exit(0));
  server.closeIdleConnections();
  // In-flight generations may run for minutes; don't hold a container stop hostage.
  setTimeout(() => process.exit(0), 5_000).unref();
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
