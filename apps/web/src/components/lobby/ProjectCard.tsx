import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { getMedia } from '../../lib/media-store';
import type { ProjectSummary } from '../../lib/projects';
import Icon from '../Icon';
import { projectStage, projectStatus, timeAgo } from './format';

/** Resolves the cover from the media store, falling back to `coverSrc`. */
function useCoverUrl(project: ProjectSummary): string | undefined {
  const { coverMediaId, coverSrc } = project;
  const [resolved, setResolved] = useState<{ id: string; url?: string }>();

  useEffect(() => {
    if (!coverMediaId) return;
    let cancelled = false;
    let objectUrl: string | undefined;
    getMedia(coverMediaId).then(
      blob => {
        if (cancelled) return;
        if (blob) objectUrl = URL.createObjectURL(blob);
        setResolved({ id: coverMediaId, url: objectUrl });
      },
      () => {
        if (!cancelled) setResolved({ id: coverMediaId });
      },
    );
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [coverMediaId]);

  if (!coverMediaId) return coverSrc;
  if (resolved?.id !== coverMediaId) return undefined;
  return resolved.url ?? coverSrc;
}

function ProjectCover({ project }: { project: ProjectSummary }) {
  const url = useCoverUrl(project);
  const [failed, setFailed] = useState<string>();
  const showMedia = url && failed !== url;
  return (
    <div className={`fo-lobby-cover${showMedia ? '' : ' is-blank'}`} aria-hidden="true">
      {showMedia ? (
        project.coverKind === 'video' ? (
          <video src={url} muted playsInline preload="metadata" onError={() => setFailed(url)} />
        ) : (
          <img src={url} alt="" loading="lazy" onError={() => setFailed(url)} />
        )
      ) : (
        <span>{project.title}</span>
      )}
    </div>
  );
}

interface CardMenuProps {
  title: string;
  onRename: () => void;
  onDelete: () => void;
}

function CardMenu({ title, onRename, onDelete }: CardMenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = [
      ...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []),
    ];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    items[(index + step + items.length) % items.length]?.focus();
  };
  const choose = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <div className={`fo-lobby-card-menu${open ? ' is-open' : ''}`} ref={root}>
      <button
        ref={trigger}
        type="button"
        className="fo-lobby-icon-button"
        aria-label={`「${title}」更多操作`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        <Icon name="more" />
      </button>
      {open && (
        <div role="menu" aria-label={`「${title}」操作`} ref={menu} onKeyDown={onKeyDown}>
          <button type="button" role="menuitem" onClick={choose(onRename)}>
            重命名
          </button>
          <button type="button" role="menuitem" className="is-danger" onClick={choose(onDelete)}>
            删除
          </button>
        </div>
      )}
    </div>
  );
}

interface ProjectCardProps {
  project: ProjectSummary;
  now: number;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}

export default function ProjectCard({
  project,
  now,
  onOpen,
  onRename,
  onDelete,
}: ProjectCardProps) {
  const stage = projectStage(project);
  return (
    <li className="fo-lobby-card">
      <ProjectCover project={project} />
      <div className="fo-lobby-card-body">
        <h3>
          <button type="button" className="fo-lobby-card-open" onClick={onOpen}>
            {project.title}
          </button>
        </h3>
        <p className={`fo-lobby-status is-${stage}`}>
          <i aria-hidden="true" />
          {projectStatus(project)}
        </p>
        <p className="fo-lobby-updated">{timeAgo(project.updatedAt, now)}更新</p>
      </div>
      <CardMenu title={project.title} onRename={onRename} onDelete={onDelete} />
    </li>
  );
}
