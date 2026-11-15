import { type CSSProperties, useEffect, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { getMedia } from '../../core/project/media-store';
import type { ProjectSummary } from '../../core/project/projects';
import Icon from '../../ui/Icon';
import type { StudioExample } from '../misc/examples';
import { type ProjectStage, projectStage, projectStatus, timeAgo } from './format';

const STAGE_BADGE: Record<ProjectStage, string | null> = {
  film: '成片',
  material: '素材',
  blank: null,
};

/** A fixed hue per project, so each blank cover keeps its own colour. */
function hueOf(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}

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
  const badge = STAGE_BADGE[projectStage(project)];
  return (
    <div
      className={`fo-lobby-cover${showMedia ? '' : ' is-blank'}`}
      style={{ '--hue': hueOf(project.id) } as CSSProperties}
      aria-hidden="true"
    >
      {badge && <span className="fo-lobby-badge">{badge}</span>}
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
        <p className="fo-lobby-meta">
          <span>{projectStatus(project)}</span>
          <span>{timeAgo(project.updatedAt, now)}</span>
        </p>
      </div>
      <CardMenu title={project.title} onRename={onRename} onDelete={onDelete} />
    </li>
  );
}

/** Always the first card: the one place to start a project. */
export function NewProjectCard({ onCreate }: { onCreate: () => void }) {
  return (
    <li className="fo-lobby-card fo-lobby-new">
      <div className="fo-lobby-cover" aria-hidden="true">
        <span>
          <Icon name="plus" />
        </span>
      </div>
      <div className="fo-lobby-card-body">
        <h3>
          <button type="button" className="fo-lobby-card-open" onClick={onCreate}>
            新建项目
          </button>
        </h3>
        <p className="fo-lobby-meta">从一块空画布开始</p>
      </div>
    </li>
  );
}

/** Shown after the new-project card while there are no projects, so the list is never bare. */
export function ExampleCard({ example, onOpen }: { example: StudioExample; onOpen: () => void }) {
  return (
    <li className="fo-lobby-card">
      <div className="fo-lobby-cover" aria-hidden="true">
        <span className="fo-lobby-badge">示例</span>
        <img src={`/assets/${example.images[0].file}`} alt="" loading="lazy" />
      </div>
      <div className="fo-lobby-card-body">
        <h3>
          <button type="button" className="fo-lobby-card-open" onClick={onOpen}>
            {example.name}
          </button>
        </h3>
        <p className="fo-lobby-meta">{example.summary}</p>
      </div>
    </li>
  );
}
