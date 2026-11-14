// Server configuration. Provider credentials are deliberately absent.
import path from 'node:path';

export interface Settings {
  /** Desktop only: reject requests whose Host is not one of these (DNS rebinding). */
  allowedHosts: readonly string[] | null;
  frontendDist: string;
  /** Bytes. */
  requestLimit: number;
  /** Milliseconds. */
  imageTimeout: number;
  /** Milliseconds. */
  queryTimeout: number;
}

// apps/server/{src,dist} → apps/web/dist
const DEFAULT_FRONTEND_DIST = path.resolve(import.meta.dirname, '..', '..', 'web', 'dist');

export function createSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    allowedHosts: null,
    frontendDist: DEFAULT_FRONTEND_DIST,
    requestLimit: 16 * 1024 * 1024,
    imageTimeout: 300_000,
    queryTimeout: 90_000,
    ...overrides,
  };
}

export function settingsFromEnv(env: NodeJS.ProcessEnv = process.env): Settings {
  return createSettings(
    env.FRAMEOUT_FRONTEND_DIST ? { frontendDist: path.resolve(env.FRAMEOUT_FRONTEND_DIST) } : {},
  );
}
