'use strict';
// Server configuration. Provider credentials are deliberately absent.

const path = require('node:path');

const LOCAL_ORIGINS = Object.freeze([
  'http://localhost:5173', 'http://127.0.0.1:5173',
  'http://localhost:8000', 'http://127.0.0.1:8000',
]);

function createSettings(overrides = {}) {
  return {
    allowedOrigins: new Set(LOCAL_ORIGINS),
    // Desktop only: reject requests whose Host is not the loopback address (DNS rebinding).
    allowedHosts: null,
    frontendDist: path.resolve(__dirname, '..', 'frontend', 'dist'),
    requestLimit: 16 * 1024 * 1024,
    responseLimit: 32 * 1024 * 1024,
    imageTimeout: 300_000,
    queryTimeout: 90_000,
    ...overrides,
  };
}

function settingsFromEnv(env = process.env) {
  const origins = new Set(LOCAL_ORIGINS);
  for (const value of (env.FRAMEOUT_ALLOWED_ORIGINS || '').split(',')) {
    const origin = value.trim().replace(/\/+$/, '');
    if (!origin) continue;
    // URL#origin drops credentials, path, query and fragment, so an exact match
    // means the value was a bare http(s) origin.
    const valid = !origin.includes('*') && URL.canParse(origin)
      && ['http:', 'https:'].includes(new URL(origin).protocol)
      && new URL(origin).origin === origin;
    if (!valid) throw new Error('FRAMEOUT_ALLOWED_ORIGINS must contain exact http(s) origins');
    origins.add(origin);
  }
  return createSettings({
    allowedOrigins: origins,
    ...(env.FRAMEOUT_FRONTEND_DIST ? { frontendDist: path.resolve(env.FRAMEOUT_FRONTEND_DIST) } : {}),
  });
}

module.exports = { LOCAL_ORIGINS, createSettings, settingsFromEnv };
