import { useCallback, useEffect, useRef } from 'react';
import type { ProjectState, UpdateProject, WorkspaceSnapshot } from '../types';
import { serializeWorkspace } from '../lib/project';
import { findProject, recordProjectSave, subscribeProjects } from '../lib/projects';

type Content = Pick<ProjectState, 'cards' | 'sequence'>;
const signature = (workspace: Content) => JSON.stringify([workspace.cards, workspace.sequence]);

/**
 * Keeps a project's entry in the project list in step with the open studio: each save refreshes
 * its counts and cover, and a rename made in the list reaches the studio.
 */
export function useProjectSync(
  projectId: string,
  projectRef: { readonly current: ProjectState },
  update: UpdateProject,
) {
  const syncedTitle = useRef<string | undefined>(undefined);
  const content = useRef<(Content & { signature: string }) | null>(null);
  if (!content.current) {
    const project = projectRef.current;
    syncedTitle.current = project.title;
    content.current = {
      cards: project.cards,
      sequence: project.sequence,
      signature: signature(serializeWorkspace(project)),
    };
  }
  /** Call after a save with the saved project and its serialized form. */
  const recordSave = useCallback(
    (project: ProjectState, workspace: WorkspaceSnapshot) => {
      const last = content.current!;
      let changed = false;
      if (project.cards !== last.cards || project.sequence !== last.sequence) {
        const value = signature(workspace);
        changed = value !== last.signature;
        content.current = { cards: project.cards, sequence: project.sequence, signature: value };
      }
      syncedTitle.current = project.title;
      recordProjectSave(projectId, project, changed);
    },
    [projectId],
  );
  useEffect(
    () =>
      subscribeProjects(() => {
        const title = findProject(projectId)?.title;
        if (!title || title === syncedTitle.current) return;
        syncedTitle.current = title;
        update(draft => {
          draft.title = title;
        }, false);
      }),
    [projectId, update],
  );
  return recordSave;
}
