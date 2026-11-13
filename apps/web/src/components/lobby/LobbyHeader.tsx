import { type RefObject, useEffect } from 'react';
import Icon from '../Icon';
import ThemeToggle from '../ThemeToggle';
import { isApplePlatform } from './format';

interface LobbyHeaderProps {
  query: string;
  onQueryChange: (query: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  deletedCount: number;
  onShowIntro: () => void;
  onShowTrash: () => void;
  onCreate: () => void;
}

/** ⌘K / Ctrl+K focuses the search field from anywhere in the lobby. */
function useSearchShortcut(searchRef: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== 'k')
        return;
      if (document.querySelector('dialog[open]')) return;
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [searchRef]);
}

export default function LobbyHeader({
  query,
  onQueryChange,
  searchRef,
  deletedCount,
  onShowIntro,
  onShowTrash,
  onCreate,
}: LobbyHeaderProps) {
  useSearchShortcut(searchRef);
  const shortcut = isApplePlatform() ? '⌘K' : 'Ctrl K';
  return (
    <header className="fo-lobby-header">
      <div className="fo-brand">
        <span className="fo-brand-mark" aria-hidden="true">
          F<span>↗</span>
        </span>
        <span className="fo-lobby-brand-word">
          FRAMEOUT<span className="fo-brand-zh">帧外</span>
        </span>
      </div>
      <div className="fo-lobby-search" role="search">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4.5 4.5" />
        </svg>
        <input
          ref={searchRef}
          type="search"
          value={query}
          placeholder="搜索项目"
          aria-label="搜索项目"
          aria-keyshortcuts="Meta+K Control+K"
          onChange={event => onQueryChange(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Escape' && query) {
              event.preventDefault();
              onQueryChange('');
            }
          }}
        />
        {!query && <kbd aria-hidden="true">{shortcut}</kbd>}
      </div>
      <nav className="fo-lobby-actions" aria-label="大厅操作">
        <button type="button" className="fo-text-button fo-lobby-intro" onClick={onShowIntro}>
          产品介绍
        </button>
        <button
          type="button"
          className="fo-lobby-icon-button fo-lobby-trash-button"
          aria-label={deletedCount ? `已删除项目（${deletedCount} 个）` : '已删除项目'}
          title="已删除项目"
          onClick={onShowTrash}
        >
          <Icon name="trash" />
          {deletedCount > 0 && <span aria-hidden="true">{deletedCount}</span>}
        </button>
        <ThemeToggle />
        <button type="button" className="fo-primary-button fo-lobby-create" onClick={onCreate}>
          <Icon name="plus" />
          新建项目
        </button>
      </nav>
    </header>
  );
}
