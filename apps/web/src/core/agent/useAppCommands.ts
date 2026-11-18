import { useEffect, useRef } from 'react';
import { listProjects } from '../project/projects';
import { AgentCommandError, projectReady, setAppHandler } from './agent-bridge';

/** list_projects and open_project, answered by the app shell whether or not a project is open. */
export function useAppCommands(openProject: (id: string) => void) {
  const open = useRef(openProject);
  open.current = openProject;
  useEffect(
    () =>
      setAppHandler(async (name, args) => {
        if (name === 'list_projects')
          return listProjects().map(project => ({
            id: project.id,
            title: project.title,
            cards: project.cardCount,
            shots: project.shotCount,
            seconds: Math.round(project.durationSeconds * 10) / 10,
            updatedAt: new Date(project.updatedAt).toISOString(),
          }));
        const id = String(args.projectId ?? '');
        if (!listProjects().some(project => project.id === id))
          throw new AgentCommandError(
            'NO_PROJECT',
            `没有这个项目：${id}，先用 list_projects 查 id`,
          );
        open.current(id);
        await projectReady(id);
        return { projectId: id, opened: true };
      }),
    [],
  );
}
