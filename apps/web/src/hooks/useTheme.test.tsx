import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ThemeToggle from '../components/ThemeToggle';
import { THEME_KEY } from '../lib/desktop-storage';
import { readThemePreference, setThemePreference, useTheme } from './useTheme';

type Listener = () => void;

/** A controllable prefers-color-scheme query. */
function stubSystem(light: boolean) {
  const listeners = new Set<Listener>();
  const query = {
    get matches() {
      return light;
    },
    addEventListener: (_: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_: string, listener: Listener) => listeners.delete(listener),
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => query),
  );
  return {
    set(next: boolean) {
      light = next;
      listeners.forEach(listener => listener());
    },
  };
}

const htmlTheme = () => document.documentElement.dataset.theme;

beforeEach(() => {
  setThemePreference('dark');
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useTheme', () => {
  it('defaults to dark when nothing is saved', () => {
    stubSystem(true);
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe('dark');
    expect(result.current.theme).toBe('dark');
    expect(htmlTheme()).toBe('dark');
  });

  it('applies and saves the light theme', () => {
    stubSystem(false);
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setPreference('light'));
    expect(result.current.theme).toBe('light');
    expect(htmlTheme()).toBe('light');
    expect(localStorage.getItem(THEME_KEY)).toBe('light');
  });

  it('follows the system setting live', () => {
    const system = stubSystem(false);
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setPreference('system'));
    expect(htmlTheme()).toBe('dark');
    act(() => system.set(true));
    expect(result.current.theme).toBe('light');
    expect(htmlTheme()).toBe('light');
    act(() => system.set(false));
    expect(htmlTheme()).toBe('dark');
  });

  it('ignores unknown saved values', () => {
    localStorage.setItem(THEME_KEY, 'neon');
    expect(readThemePreference()).toBe('dark');
  });

  it('keeps the choice for this session when storage refuses it', () => {
    stubSystem(false);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setPreference('light'));
    expect(htmlTheme()).toBe('light');
  });

  it('picks up a change made in another tab', () => {
    stubSystem(false);
    const { result } = renderHook(() => useTheme());
    localStorage.setItem(THEME_KEY, 'light');
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: THEME_KEY })));
    expect(result.current.theme).toBe('light');
  });

  it('works when matchMedia is missing', () => {
    vi.stubGlobal('matchMedia', undefined);
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setPreference('system'));
    expect(result.current.theme).toBe('dark');
  });
});

describe('ThemeToggle', () => {
  it('steps through dark, light and follow-system', async () => {
    stubSystem(true);
    const user = userEvent.setup();
    render(<ThemeToggle />);
    const button = screen.getByRole('button', { name: '界面颜色：深色，点击切换' });
    expect(button.textContent).toBe('深色');

    await user.click(button);
    expect(button.getAttribute('aria-label')).toBe('界面颜色：浅色，点击切换');
    expect(htmlTheme()).toBe('light');

    await user.click(button);
    expect(button.textContent).toBe('跟随系统');
    expect(htmlTheme()).toBe('light');
    expect(localStorage.getItem(THEME_KEY)).toBe('system');

    await user.click(button);
    expect(button.textContent).toBe('深色');
    expect(htmlTheme()).toBe('dark');
  });
});
