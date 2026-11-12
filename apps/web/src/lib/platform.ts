// The only module that reads the Electron bridge. Everything else asks here
// whether it runs on the desktop, so browser and desktop paths stay in one place.
import type { DesktopBridge } from '@frameout/shared';

declare global {
  interface Window { frameoutDesktop?: DesktopBridge }
}

/** The desktop bridge, or undefined in a browser. Read on every call so tests can stub it. */
export const desktopBridge = (): DesktopBridge | undefined => window.frameoutDesktop;

export const isDesktop = (): boolean => desktopBridge() !== undefined;
