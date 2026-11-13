import { useRef, useState } from 'react';
import { PROJECT_TITLE_MAX } from '../lib/project';
import '../styles/project-title.css';

interface ProjectTitleProps {
  title: string;
  /** Receives the typed name; the caller trims it and falls back to the default name. */
  onRename?: (title: string) => void;
}

/** The project name in the header. Click to edit; Enter or leaving the field saves, Esc cancels. */
export default function ProjectTitle({ title, onRename }: ProjectTitleProps) {
  const [draft, setDraft] = useState<string | null>(null);
  // Esc and Enter end editing before blur fires; blur must not save again or undo the cancel.
  const finished = useRef(false);
  const button = useRef<HTMLButtonElement>(null);
  if (!onRename) return <span className="fo-project-title">{title}</span>;
  const finish = (save: boolean, refocus = false) => {
    if (finished.current || draft === null) return;
    finished.current = true;
    if (save && draft.trim() !== title) onRename(draft);
    setDraft(null);
    // Keyboard users stay on the name; a click elsewhere keeps its own focus.
    if (refocus) requestAnimationFrame(() => button.current?.focus());
  };
  if (draft === null)
    return (
      <button
        ref={button}
        type="button"
        className="fo-project-title fo-project-title-button"
        title="点击改名"
        aria-label={`项目名称：${title}，点击改名`}
        onClick={() => {
          finished.current = false;
          setDraft(title);
        }}
      >
        {title}
      </button>
    );
  return (
    <input
      className="fo-project-title fo-project-title-input"
      aria-label="项目名称"
      value={draft}
      maxLength={PROJECT_TITLE_MAX}
      autoFocus
      onFocus={event => event.currentTarget.select()}
      onChange={event => setDraft(event.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          finish(true, true);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          finish(false, true);
        }
      }}
    />
  );
}
