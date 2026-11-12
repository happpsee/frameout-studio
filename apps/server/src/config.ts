// Server configuration. Provider credentials are deliberately absent.
import path from 'node:path';

export const LOCAL_ORIGINS = Object.freeze([
  'http://localhost:5173', 'http://127.0.0.1:5173',
  'http://localhost:8000', 'http://127.0.0.1:8000',
]);

export interface Settings {
  allowedOrigins: ReadonlySet<string>;
  /** Desktop only: reject requests whose Host is not one of these (DNS rebinding). */
  allowedHosts: readonly string[] | null;
  frontendDist: string;
  requestLimit: number;
  responseLimit: number;
  /** Milliseconds. */
  imageTimeout: number;
  /** Milliseconds. */
  queryTimeout: number;
}

// apps/server/{src,dist} → apps/web/dist
const DEFAULT_FRONTEND_DIST = path.resolve(import.meta.dirname, '..', '..', 'web', 'dist');

export function createSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    allowedOrigins: new Set(LOCAL_ORIGINS),
    allowedHosts: null,
    frontendDist: DEFAULT_FRONTEND_DIST,
    requestLimit: 16 * 1024 * 1024,
    responseLimit: 32 * 1024 * 1024,
    imageTimeout: 300_000,
    queryTimeout: 90_000,
    ...overrides,
  };
}

export function settingsFromEnv(env: NodeJS.ProcessEnv = process.env): Settings {
  const origins = new Set(LOCAL_ORIGINS);
  for (const value of (env.FRAMEOUT_ALLOWED_ORIGINS ?? '').split(',')) {
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
