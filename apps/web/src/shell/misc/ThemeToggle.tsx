import type { ReactNode } from 'react';
import { type ThemePreference, useTheme } from './useTheme';

const LABELS: Record<ThemePreference, string> = {
  dark: '深色',
  light: '浅色',
  system: '跟随系统',
};
const NEXT: Record<ThemePreference, ThemePreference> = {
  dark: 'light',
  light: 'system',
  system: 'dark',
};
const ICONS: Record<ThemePreference, ReactNode> = {
  dark: <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" />,
  light: (
    <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-5v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
  ),
  system: <path d="M3 5h18v11H3V5Zm5 15h8m-4-4v4" />,
};

/** One button that steps through 深色 → 浅色 → 跟随系统 and shows the current choice. */
export default function ThemeToggle() {
  const { preference, setPreference } = useTheme();
  const label = LABELS[preference];
  return (
    <button
      type="button"
      className="fo-text-button fo-theme-toggle"
      aria-label={`界面颜色：${label}，点击切换`}
      title="切换界面颜色：深色、浅色、跟随系统"
      onClick={() => setPreference(NEXT[preference])}
    >
      <span data-icon="theme" aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {ICONS[preference]}
        </svg>
      </span>
      <span>{label}</span>
    </button>
  );
}
