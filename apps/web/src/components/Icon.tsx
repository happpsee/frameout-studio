import type { ReactNode } from 'react';

const paths: Record<string, ReactNode> = {
  'arrow-up-right': <path d="M5 19 19 5M5 5h14v14" />,
  'arrow-down': <path d="M12 4v16M5 13l7 7 7-7" />,
  'arrow-up': <path d="M12 20V4M5 11l7-7 7 7" />,
  'arrow-left': <path d="M20 12H4m7-7-7 7 7 7" />,
  'arrow-right': <path d="M4 12h16m-7-7 7 7-7 7" />,
  'chevron-left': <path d="m15 5-7 7 7 7" />,
  'chevron-right': <path d="m9 5 7 7-7 7" />,
  'chevron-down': <path d="m5 9 7 7 7-7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  x: <path d="m6 6 12 12M18 6 6 18" />,
  play: <path d="m8 4 12 8-12 8V4Z" />,
  pause: <path d="M8 5v14M16 5v14" />,
  folder: <path d="M3 7V5h6l2 3h10v12H3V7Z" />,
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8" cy="8" r="1.5" />
      <path d="m21 16-6-6L5 21" />
    </>
  ),
  film: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="1" />
      <path d="M7 3v18M17 3v18M3 8h4m-4 8h4m10-8h4m-4 8h4" />
    </>
  ),
  upload: <path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5" />,
  download: <path d="M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5" />,
  maximize: <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />,
  hand: (
    <path d="M8 12V5a2 2 0 0 1 4 0v7-8a2 2 0 0 1 4 0v8-6a2 2 0 0 1 4 0v8c0 4-3 7-7 7h-1c-2 0-4-1-5-3l-4-5a2 2 0 0 1 3-2l2 2Z" />
  ),
  cursor: <path d="m4 3 15 10-7 2-3 7L4 3Z" />,
  undo: <path d="M4 5v6h6M4 11a8 8 0 1 1 2 8" />,
  redo: <path d="M20 5v6h-6m6 0a8 8 0 1 0-2 8" />,
  trash: <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" />,
  copy: (
    <>
      <rect x="8" y="8" width="13" height="13" rx="2" />
      <path d="M16 8V3H3v13h5" />
    </>
  ),
  sparkles: <path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7ZM20 1v4m-2-2h4" />,
  settings: (
    <>
      <path d="M4 7h16M4 17h16" />
      <circle cx="9" cy="7" r="3" />
      <circle cx="15" cy="17" r="3" />
    </>
  ),
  check: <path d="m5 12 4 4L20 5" />,
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 8a3 3 0 1 1 4 3c-1 .5-1 1-1 2m0 3v.1" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 6v6l4 2" />
    </>
  ),
  tidy: <path d="M4 5h6v6H4zM14 5h6v6h-6zM4 15h6v4H4zM14 15h6v4h-6z" />,
  text: <path d="M5 6h14M5 11h14M5 16h9" />,
  list: <path d="M9 6h11M9 12h11M9 18h11M4 6h.1M4 12h.1M4 18h.1" />,
};

/** React SVGs keep the existing icon styling without injecting markup. */
export default function Icon({ name, className }: { name: string; className?: string }) {
  return (
    <span data-icon={name} className={className} aria-hidden="true">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {paths[name] ?? paths.sparkles}
      </svg>
    </span>
  );
}
