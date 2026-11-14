import { useCallback, useEffect, useRef, useState } from 'react';
import { DESKTOP_INTRO_KEY, readStoredValue, writeStoredValue } from '../lib/desktop-storage';
import { peekExampleRequest } from '../lib/examples';
import { isDesktop } from '../lib/platform';
import {
  createProject,
  findProject,
  lastOpenedProjectId,
  listProjects,
  markProjectOpened,
  prepareProject,
  subscribeProjects,
} from '../lib/projects';

type Route = { view: 'intro' } | { view: 'lobby' } | { view: 'studio'; projectId: string };
interface Resolved {
  route: Route;
  /** Shown over the project list when an address could not be opened. */
  notice?: string;
  /** Address to put in place of the one that was asked for. */
  replace?: string;
}

const MISSING_PROJECT_NOTICE = '没有找到这个项目，已回到项目列表';
const DELETED_PROJECT_NOTICE = '这个项目已删除，可在「已删除项目」里恢复';
const UNREADABLE_PROJECT_NOTICE = '项目读取失败，请检查应用数据目录后重试';
const STUDIO_HASH = /^#studio\/(.*)$/;
const LOBBY: Route = { view: 'lobby' };
const INTRO: Route = { view: 'intro' };

const routeHash = (route: Route) =>
  route.view === 'studio'
    ? `#studio/${route.projectId}`
    : route.view === 'lobby'
      ? '#projects'
      : '#intro';
const introSeen = () => readStoredValue(DESKTOP_INTRO_KEY) === 'seen';
export function markIntroSeen() {
  if (introSeen()) return;
  try {
    void writeStoredValue(DESKTOP_INTRO_KEY, 'seen')?.catch(() => {});
  } catch {
    /* Only decides what the next visit opens with. */
  }
}
const openable = (id: string) => findProject(id)?.deletedAt === undefined;

/** The project an old `#studio` address meant: the last one opened, else the newest, else a new one. */
function defaultProjectId(): string {
  return lastOpenedProjectId() ?? listProjects()[0]?.id ?? createProject().id;
}

/** Where a web address leads. History state tells a visited introduction from the project list. */
function routeFromLocation(hash: string, state?: unknown): Resolved {
  if (hash === '#intro') return { route: INTRO };
  if (hash === '#projects') return { route: LOBBY };
  if (hash === '#studio') {
    const projectId = defaultProjectId();
    return { route: { view: 'studio', projectId }, replace: `#studio/${projectId}` };
  }
  const match = STUDIO_HASH.exec(hash);
  if (match) {
    const id = decodeURIComponent(match[1]);
    const entry = findProject(id);
    if (entry && entry.deletedAt === undefined)
      return { route: { view: 'studio', projectId: entry.id } };
    const notice = entry ? DELETED_PROJECT_NOTICE : MISSING_PROJECT_NOTICE;
    return { route: LOBBY, notice, replace: '#projects' };
  }
  if ((state as { frameoutView?: string } | null)?.frameoutView === 'intro')
    return { route: INTRO };
  return { route: introSeen() ? LOBBY : INTRO };
}

function initialRoute(): Resolved {
  if (isDesktop()) return { route: introSeen() ? LOBBY : INTRO };
  const resolved = routeFromLocation(location.hash, history.state);
  if (resolved.replace) history.replaceState(null, '', resolved.replace);
  // An introduction shown at the bare address is remembered so "back" can return to it.
  else if (!location.hash && resolved.route.view === 'intro')
    history.replaceState({ frameoutView: 'intro' }, '');
  if (resolved.route.view === 'studio') markProjectOpened(resolved.route.projectId);
  return resolved;
}

function useNotice(initial = '') {
  const [notice, setNotice] = useState(initial);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  return [notice, setNotice] as const;
}

/**
 * The app's three places: the introduction, the project list and a project's studio.
 * The last studio stays mounted (hidden) while the list or introduction shows, so an unfinished
 * prompt, the in-page key and undo history survive a quick look around.
 */
export function useProjectRoute() {
  const [initial] = useState(initialRoute);
  const [route, setRoute] = useState<Route>(initial.route);
  const [kept, setKept] = useState(
    initial.route.view === 'studio' ? initial.route.projectId : null,
  );
  const [notice, setNotice] = useNotice(initial.notice);
  const routeRef = useRef(route);
  routeRef.current = route;
  const opening = useRef(0);
  const returnTo = useRef<string | null>(null);
  const scroll = useRef(0);

  const go = useCallback((next: Route, history: 'push' | 'none' = 'push') => {
    opening.current++;
    setRoute(current => {
      if (current.view === 'intro' && next.view !== 'intro') scroll.current = window.scrollY;
      return next;
    });
    if (next.view === 'studio') setKept(next.projectId);
    if (next.view === 'intro')
      requestAnimationFrame(() => window.scrollTo({ top: scroll.current, behavior: 'instant' }));
    if (history === 'push' && !isDesktop() && location.hash !== routeHash(next))
      window.history.pushState(null, '', routeHash(next));
  }, []);

  const openProject = useCallback(
    (id: string, history: 'push' | 'none' = 'push') => {
      const entry = findProject(id);
      if (!entry || entry.deletedAt !== undefined) {
        setNotice(entry ? DELETED_PROJECT_NOTICE : MISSING_PROJECT_NOTICE);
        go(LOBBY, history);
        return;
      }
      const show = () => {
        markProjectOpened(id);
        go({ view: 'studio', projectId: id }, history);
      };
      if (!isDesktop()) return show();
      const attempt = ++opening.current;
      prepareProject(id).then(
        () => {
          if (attempt === opening.current) show();
        },
        () => {
          if (attempt !== opening.current) return;
          setNotice(UNREADABLE_PROJECT_NOTICE);
          go(LOBBY, history);
        },
      );
    },
    [go, setNotice],
  );

  const showLobby = useCallback(() => go(LOBBY), [go]);
  const showIntro = useCallback(
    (from: string | null = null) => {
      returnTo.current = from;
      go(INTRO);
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

  useEffect(() => {
    if (isDesktop()) return;
    const change = (event?: PopStateEvent) => {
      const resolved = routeFromLocation(location.hash, event ? event.state : history.state);
      if (resolved.replace) history.replaceState(null, '', resolved.replace);
      if (resolved.notice) setNotice(resolved.notice);
      if (resolved.route.view === 'studio') openProject(resolved.route.projectId, 'none');
      else go(resolved.route, 'none');
    };
    const onHash = () => change();
    window.addEventListener('popstate', change);
    window.addEventListener('hashchange', onHash);
    return () => {
      window.removeEventListener('popstate', change);
      window.removeEventListener('hashchange', onHash);
    };
  }, [go, openProject, setNotice]);

  // A project deleted from the list must not stay mounted behind it.
  useEffect(
    () =>
      subscribeProjects(() => {
        const current = routeRef.current;
        setKept(id =>
          id && (openable(id) || (current.view === 'studio' && current.projectId === id))
            ? id
            : null,
        );
      }),
    [],
  );

  return { route, kept, notice, openProject, showLobby, showIntro, leaveIntro };
}
