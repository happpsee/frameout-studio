import { useLayoutEffect, useSyncExternalStore } from 'react';
import { THEME_KEY, readStoredValue, writeStoredValue } from '../../lib/desktop-storage';

type Theme = 'dark' | 'light';
export type ThemePreference = Theme | 'system';

const PREFERENCES: readonly ThemePreference[] = ['dark', 'light', 'system'];
const SYSTEM_LIGHT = '(prefers-color-scheme: light)';
const listeners = new Set<() => void>();
// A choice that storage refused to save; it still applies until the page reloads.
let chosen: ThemePreference | null = null;

export function readThemePreference(): ThemePreference {
  if (chosen) return chosen;
  let saved: string | null = null;
  try {
    saved = readStoredValue(THEME_KEY);
  } catch {
    // Storage can be blocked (private mode, sandboxed frames); fall back to the default.
  }
  return PREFERENCES.find(preference => preference === saved) ?? 'dark';
}

function systemQuery(): MediaQueryList | undefined {
  return typeof window.matchMedia === 'function' ? window.matchMedia(SYSTEM_LIGHT) : undefined;
}

function systemPrefersLight(): boolean {
  return systemQuery()?.matches === true;
}

function resolveTheme(preference: ThemePreference, systemLight: boolean): Theme {
  if (preference === 'system') return systemLight ? 'light' : 'dark';
  return preference;
}

/** The studio palette in studio.css switches on this attribute. */
function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

function subscribePreference(notify: () => void) {
  listeners.add(notify);
  const fromOtherTab = (event: StorageEvent) => {
    if (event.key !== THEME_KEY) return;
    chosen = null;
    notify();
  };
  window.addEventListener('storage', fromOtherTab);
  return () => {
    listeners.delete(notify);
    window.removeEventListener('storage', fromOtherTab);
  };
}

function subscribeSystem(notify: () => void) {
  const query = systemQuery();
  // Test doubles and old engines may hand back a query without change events.
  query?.addEventListener?.('change', notify);
  return () => query?.removeEventListener?.('change', notify);
}

export function setThemePreference(preference: ThemePreference): void {
  chosen = null;
  try {
    void writeStoredValue(THEME_KEY, preference)?.catch(() => {});
  } catch {
    chosen = preference;
  }
  for (const notify of listeners) notify();
}

export function useTheme() {
  const preference = useSyncExternalStore(subscribePreference, readThemePreference);
  const systemLight = useSyncExternalStore(subscribeSystem, systemPrefersLight);
  const theme = resolveTheme(preference, systemLight);
  // Layout effect: the attribute is set before the browser paints the studio.
  useLayoutEffect(() => applyTheme(theme), [theme]);
  return { preference, theme, setPreference: setThemePreference };
}

// Apply the saved theme as soon as the studio code loads, before React renders anything.
// The desktop app loads its storage asynchronously, so there the hook applies it on first render.
if (typeof document !== 'undefined')
  applyTheme(resolveTheme(readThemePreference(), systemPrefersLight()));
