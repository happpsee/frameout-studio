import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useMatch, useNavigate } from 'react-router';
import {
  DESKTOP_INTRO_KEY,
  readStoredValue,
  writeStoredValue,
} from '../core/project/desktop-storage';
import { peekExampleRequest } from './misc/examples';
import { isDesktop } from '../platform';
import {
  createProject,
  findProject,
  lastOpenedProjectId,
  listProjects,
  markProjectOpened,
  prepareProject,
  subscribeProjects,
} from '../core/project/projects';

export type View = 'intro' | 'lobby' | 'studio';

const MISSING_PROJECT_NOTICE = '没有找到这个项目，已回到项目列表';
const DELETED_PROJECT_NOTICE = '这个项目已删除，可在「已删除项目」里恢复';
const UNREADABLE_PROJECT_NOTICE = '项目读取失败，请检查应用数据目录后重试';

const introSeen = () => readStoredValue(DESKTOP_INTRO_KEY) === 'seen';
export function markIntroSeen() {
  if (introSeen()) return;
  try {
    void writeStoredValue(DESKTOP_INTRO_KEY, 'seen')?.catch(() => {});
  } catch {
    /* Only decides what the next visit opens with. */
  }
}
/** The project exists and is not in the trash. */
function openable(id: string): boolean {
  const entry = findProject(id);
  return entry !== undefined && entry.deletedAt === undefined;
}

/** The project an old `#/studio` address meant: the last one opened, else the newest, else a new one. */
export function defaultProjectId(): string {
  return lastOpenedProjectId() ?? listProjects()[0]?.id ?? createProject().id;
}

/** Addresses were once written without the slash (`#studio/abc`); keep those links working. */
export function upgradeOldAddress() {
  if (/^#(intro|projects|studio)/.test(location.hash))
    history.replaceState(history.state, '', `#/${location.hash.slice(1)}`);
}

function useNotice() {
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  return [notice, setNotice] as const;
}

/**
 * Moving between the app's three places: the introduction, the project list and a project's
 * studio. The routes themselves are declared in App.tsx; this hook decides when to go where.
 *
 * The last studio stays mounted (hidden) while the list or introduction shows, so an unfinished
 * prompt, the in-page key and undo history survive a quick look around. `kept` is that project.
 */
export function useProjectRoute() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const studioId = useMatch('/studio/:projectId')?.params.projectId ?? null;
  // Decided once: a first-time visitor sees the introduction at the bare address all visit long.
  const [startsWithIntro] = useState(() => !introSeen());
  const view: View = studioId
    ? 'studio'
    : pathname === '/intro' || (pathname === '/' && startsWithIntro)
      ? 'intro'
      : 'lobby';
  const [kept, setKept] = useState<string | null>(null);
  const [notice, setNotice] = useNotice();
  const here = useRef({ pathname, view, studioId });
  here.current = { pathname, view, studioId };
  const opening = useRef(0);
  const returnTo = useRef<string | null>(null);
  const scroll = useRef(0);

  const go = useCallback(
    (to: string) => {
      // A desktop project still being read must not open over the page chosen since.
      opening.current++;
      if (here.current.view === 'intro') scroll.current = window.scrollY;
      if (to !== here.current.pathname) navigate(to);
    },
    [navigate],
  );

  const openProject = useCallback(
    (id: string) => {
      const entry = findProject(id);
      if (!entry || entry.deletedAt !== undefined) {
        setNotice(entry ? DELETED_PROJECT_NOTICE : MISSING_PROJECT_NOTICE);
        go('/projects');
        return;
      }
      if (!isDesktop()) return go(`/studio/${id}`);
      // The desktop app reads the project's files before showing it.
      const attempt = ++opening.current;
      prepareProject(id).then(
        () => {
          if (attempt === opening.current) go(`/studio/${id}`);
        },
        () => {
          if (attempt !== opening.current) return;
          setNotice(UNREADABLE_PROJECT_NOTICE);
          go('/projects');
        },
      );
    },
    [go, setNotice],
  );

  const showLobby = useCallback(() => go('/projects'), [go]);
  const showIntro = useCallback(
    (from: string | null = null) => {
      returnTo.current = from;
      go('/intro');
    },
    [go],
  );
  /** "打开创作画布" and the example tiles on the introduction. */
  const leaveIntro = useCallback(() => {
    markIntroSeen();
    const back = returnTo.current;
    returnTo.current = null;
    const example = peekExampleRequest();
    if (example) openProject(createProject(example.name).id);
    else if (back && openable(back)) openProject(back);
    else if (!listProjects().length) openProject(createProject().id);
    else showLobby();
  }, [openProject, showLobby]);

  // The address names a project (a link, the back button, or `go` above): show it, or say why not.
  useEffect(() => {
    if (!studioId) return;
    if (openable(studioId)) {
      markProjectOpened(studioId);
      setKept(studioId);
      return;
    }
    setNotice(findProject(studioId) ? DELETED_PROJECT_NOTICE : MISSING_PROJECT_NOTICE);
    navigate('/projects', { replace: true });
  }, [studioId, navigate, setNotice]);

  // Back on the introduction: return to where the reader was.
  useEffect(() => {
    if (view !== 'intro') return;
    const frame = requestAnimationFrame(() =>
      window.scrollTo({ top: scroll.current, behavior: 'instant' }),
    );
    return () => cancelAnimationFrame(frame);
  }, [view]);

  // A project deleted from the list must not stay mounted behind it.
  useEffect(
    () =>
      subscribeProjects(() =>
        setKept(id => (id && (openable(id) || here.current.studioId === id) ? id : null)),
      ),
    [],
  );

  return {
    view,
    startsWithIntro,
    /** The studio to draw, and whether it is the page on screen. */
    kept,
    studioActive: view === 'studio' && kept === studioId,
    notice,
    openProject,
    showLobby,
    showIntro,
    leaveIntro,
  };
}
