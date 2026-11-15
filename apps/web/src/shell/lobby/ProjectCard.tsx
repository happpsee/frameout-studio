import { type CSSProperties, useEffect, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { getMedia } from '../../core/project/media-store';
import type { ProjectSummary } from '../../core/project/projects';
import Icon from '../../ui/Icon';
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
        <span>+</span>
      )}
    </div>
  );
}

interface CardMenuProps {
  title: string;
  onRename: () => void;
  onDelete: () => void;
}

/** The "…" button on a card. Radix does the menu behaviour; lobby.css gives it its look. */
function CardMenu({ title, onRename, onDelete }: CardMenuProps) {
  return (
    <div className="fo-lobby-card-menu">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger className="fo-lobby-icon-button" aria-label={`「${title}」更多操作`}>
          <Icon name="more" />
        </DropdownMenu.Trigger>
        {/* No portal: the menu stays inside the card, where the lobby's styles reach it. */}
        <DropdownMenu.Content align="end" sideOffset={6}>
          <DropdownMenu.Item onSelect={onRename}>重命名</DropdownMenu.Item>
          <DropdownMenu.Item className="is-danger" onSelect={onDelete}>
            删除
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
  );
}

interface ProjectCardProps {
  project: ProjectSummary;
  /** Position in the grid: later cards rise in a little later. */
  index: number;
  now: number;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}

export default function ProjectCard({
  project,
  index,
  now,
  onOpen,
  onRename,
  onDelete,
}: ProjectCardProps) {
  const stage = projectStage(project);
  // The entrance plays once. A re-sort re-inserts the element, which would restart a CSS
  // animation, so the class that carries it is dropped as soon as it has finished.
  const [arriving, setArriving] = useState(true);
  return (
    <li
      className={`fo-lobby-card${arriving ? ' is-arriving' : ''}`}
      style={{ '--i': index } as CSSProperties}
      onAnimationEnd={event => {
        if (event.target === event.currentTarget) setArriving(false);
      }}
    >
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
