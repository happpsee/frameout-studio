import { useEffect } from 'react';
import { HashRouter, MemoryRouter, Navigate, Route, Routes } from 'react-router';
import Landing from './shell/landing/Landing';
import Lobby from './shell/lobby/Lobby';
import Studio from './core/Studio';
import { flushDesktopStorage } from './core/project/desktop-storage';
import { desktopBridge, isDesktop } from './platform';
import {
  defaultProjectId,
  markIntroSeen,
  upgradeOldAddress,
  useProjectRoute,
} from './shell/useProjectRoute';

const TITLES = {
  intro: '帧外 FRAMEOUT — 让灵感，发生。',
  lobby: '项目 — 帧外 FRAMEOUT',
  studio: '创作画布 — 帧外 FRAMEOUT',
};

/** An old address that names no project opens the last one used. */
function LastProject() {
  return <Navigate to={`/studio/${defaultProjectId()}`} replace />;
}

function Pages() {
  const {
    view,
    startsWithIntro,
    kept,
    studioActive,
    phase,
    notice,
    openProject,
    showLobby,
    showIntro,
    leaveIntro,
  } = useProjectRoute();
  useEffect(() => {
    // Record the first display, including when the user quits before entering the canvas.
    if (isDesktop() && view === 'intro') markIntroSeen();
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

  const landing = <Landing onOpenStudio={leaveIntro} />;
  const lobby = <Lobby onOpenProject={openProject} onShowIntro={() => showIntro()} />;
  return (
    <>
      <Routes>
        <Route path="/" element={startsWithIntro ? landing : lobby} />
        <Route path="/intro" element={landing} />
        <Route path="/projects" element={lobby} />
        <Route path="/studio" element={<LastProject />} />
        {/* The studio is drawn below, outside the routes, so it can stay mounted while hidden. */}
        <Route path="/studio/:projectId" element={null} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {kept && (
        <Studio
          key={kept}
          projectId={kept}
          active={studioActive}
          onClose={showLobby}
          onShowIntro={() => showIntro(kept)}
        />
      )}
      <div className="fo-curtain" data-phase={phase} aria-hidden="true">
        <i className="fo-curtain-block" />
        <i className="fo-curtain-block">Frameout</i>
      </div>
      {notice && (
        <div className="fo-toast fo-app-notice is-visible" role="status" aria-live="polite">
          {notice}
        </div>
      )}
    </>
  );
}

export default function App() {
  // The desktop app has no address bar, so its pages live in memory.
  if (isDesktop()) {
    return (
      <MemoryRouter>
        <Pages />
      </MemoryRouter>
    );
  }
  upgradeOldAddress();
  return (
    <HashRouter>
      <Pages />
    </HashRouter>
  );
}
