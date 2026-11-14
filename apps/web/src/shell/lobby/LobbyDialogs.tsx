import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { closeOnBackdropClick } from '../../ui/dialog';
import type { ProjectSummary } from '../../lib/projects';
import Icon from '../../ui/Icon';
import { TRASH_DAYS, daysLeft, timeAgo } from './format';

interface LobbyDialogProps {
  title: string;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}

/** A modal that is open while mounted. Esc and a backdrop click close it. */
function LobbyDialog({ title, onClose, className, children }: LobbyDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      className={`fo-lobby-dialog${className ? ' ' + className : ''}`}
      aria-labelledby={headingId}
      onCancel={event => {
        event.preventDefault();
        onClose();
      }}
      onClick={closeOnBackdropClick(onClose)}
    >
      <div className="fo-lobby-dialog-head">
        <h2 id={headingId}>{title}</h2>
        <button type="button" className="fo-lobby-icon-button" aria-label="关闭" onClick={onClose}>
          <Icon name="x" />
        </button>
      </div>
      {children}
    </dialog>
  );
}

interface RenameDialogProps {
  project: ProjectSummary;
  onRename: (title: string) => void;
  onClose: () => void;
}

export function RenameDialog({ project, onRename, onClose }: RenameDialogProps) {
  const [title, setTitle] = useState(project.title);
  const trimmed = title.trim();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!trimmed) return;
    if (trimmed !== project.title) onRename(trimmed);
    onClose();
  };
  return (
    <LobbyDialog title="重命名项目" onClose={onClose}>
      <form onSubmit={submit}>
        <label className="fo-lobby-field">
          <span>项目名称</span>
          <input
            value={title}
            maxLength={80}
            autoFocus
            onFocus={event => event.currentTarget.select()}
            onChange={event => setTitle(event.target.value)}
          />
        </label>
        <div className="fo-lobby-dialog-actions">
          <button type="button" className="fo-lobby-secondary" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="fo-primary-button" disabled={!trimmed}>
            保存
          </button>
        </div>
      </form>
    </LobbyDialog>
  );
}

interface DeleteDialogProps {
  project: ProjectSummary;
  onDelete: () => void;
  onClose: () => void;
}

export function DeleteDialog({ project, onDelete, onClose }: DeleteDialogProps) {
  return (
    <LobbyDialog title={`删除「${project.title}」？`} onClose={onClose}>
      <p className="fo-lobby-dialog-text">会移入已删除项目，保留 {TRASH_DAYS} 天，可以恢复。</p>
      <div className="fo-lobby-dialog-actions">
        <button type="button" className="fo-lobby-secondary" autoFocus onClick={onClose}>
          取消
        </button>
        <button
          type="button"
          className="fo-lobby-danger"
          onClick={() => {
            onDelete();
            onClose();
          }}
        >
          删除
        </button>
      </div>
    </LobbyDialog>
  );
}

interface TrashDialogProps {
  projects: readonly ProjectSummary[];
  now: number;
  onRestore: (id: string) => void;
  onClose: () => void;
}

export function TrashDialog({ projects, now, onRestore, onClose }: TrashDialogProps) {
  return (
    <LobbyDialog title="已删除项目" className="fo-lobby-trash" onClose={onClose}>
      <p className="fo-lobby-dialog-text">删除的项目保留 {TRASH_DAYS} 天，之后自动清除。</p>
      {projects.length ? (
        <ul className="fo-lobby-trash-list">
          {projects.map(project => (
            <li key={project.id}>
              <div>
                <strong>{project.title}</strong>
                <span>
                  {project.deletedAt ? `${timeAgo(project.deletedAt, now)}删除 · ` : ''}
                  还剩 {daysLeft(project.deletedAt ?? now, now)} 天
                </span>
              </div>
              <button
                type="button"
                className="fo-lobby-secondary"
                aria-label={`恢复「${project.title}」`}
                onClick={() => onRestore(project.id)}
              >
                恢复
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="fo-lobby-trash-empty">没有已删除的项目。</p>
      )}
    </LobbyDialog>
  );
}
