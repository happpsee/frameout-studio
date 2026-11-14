import { useEffect } from 'react';
import Landing from './shell/landing/Landing';
import Lobby from './shell/lobby/Lobby';
import Studio from './core/Studio';
import {
  DESKTOP_INTRO_KEY,
  flushDesktopStorage,
  readStoredValue,
} from './core/project/desktop-storage';
import { desktopBridge, isDesktop } from './platform';
import { markIntroSeen, useProjectRoute } from './shell/useProjectRoute';

const TITLES = {
  intro: '帧外 FRAMEOUT — 让灵感，发生。',
  lobby: '项目 — 帧外 FRAMEOUT',
  studio: '创作画布 — 帧外 FRAMEOUT',
};

export default function App() {
  const { route, kept, notice, openProject, showLobby, showIntro, leaveIntro } = useProjectRoute();
  const { view } = route;
  useEffect(() => {
    if (isDesktop() && view === 'intro' && readStoredValue(DESKTOP_INTRO_KEY) !== 'seen') {
      // Record the first display, including when the user quits before entering the canvas.
      markIntroSeen();
    }
  }, [view]);
  useEffect(() => desktopBridge()?.onBeforeClose(flushDesktopStorage), []);
  useEffect(() => {
    if (view === 'studio') document.body.dataset.studio = 'true';
    else delete document.body.dataset.studio;
    document.title = TITLES[view];
    return () => {
      delete document.body.dataset.studio;
    };
  }, [view]);
  return (
    <>
      {view === 'intro' && <Landing onOpenStudio={leaveIntro} />}
      {view === 'lobby' && <Lobby onOpenProject={openProject} onShowIntro={() => showIntro()} />}
      {kept && (
        <Studio
          key={kept}
          projectId={kept}
          active={view === 'studio'}
          onClose={showLobby}
          onShowIntro={() => showIntro(kept)}
        />
      )}
      {notice && (
        <div className="fo-toast fo-app-notice is-visible" role="status" aria-live="polite">
          {notice}
        </div>
      )}
    </>
  );
}
