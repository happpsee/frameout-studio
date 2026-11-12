import { useCallback, useEffect, useRef, useState } from 'react';
import Landing from './components/Landing';
import Studio from './components/Studio';
import { DESKTOP_INTRO_KEY, flushDesktopStorage, readStoredValue, writeStoredValue } from './lib/desktop-storage';
import { desktopBridge, isDesktop } from './lib/platform';

export default function App() {
  const desktop = isDesktop();
  const initialStudio = desktop ? readStoredValue(DESKTOP_INTRO_KEY) === 'seen' : location.hash === '#studio';
  const [studio, setStudio] = useState(initialStudio);
  const [studioVisited, setStudioVisited] = useState(initialStudio);
  const scroll = useRef(0);
  const openStudio = useCallback(() => {
    scroll.current = window.scrollY;
    setStudioVisited(true); setStudio(true);
    if (location.hash !== '#studio') history.pushState(null, '', '#studio');
  }, []);
  const closeStudio = useCallback(() => {
    setStudio(false);
    history.replaceState(null, '', location.pathname + location.search);
    requestAnimationFrame(() => window.scrollTo({ top: scroll.current, behavior: 'instant' }));
  }, []);
  useEffect(() => {
    if (desktop) return;
    const change = () => { const active = location.hash === '#studio'; setStudio(active); if (active) setStudioVisited(true); };
    window.addEventListener('popstate', change);
    window.addEventListener('hashchange', change);
    return () => { window.removeEventListener('popstate', change); window.removeEventListener('hashchange', change); };
  }, [desktop]);
  useEffect(() => {
    if (desktop && !studio && readStoredValue(DESKTOP_INTRO_KEY) !== 'seen') {
      // Record the first display, including when the user quits before entering the canvas.
      void writeStoredValue(DESKTOP_INTRO_KEY, 'seen')?.catch(() => {});
    }
  }, [desktop, studio]);
  useEffect(() => desktopBridge()?.onBeforeClose(flushDesktopStorage), []);
  useEffect(() => {
    if (studio) document.body.dataset.studio = 'true'; else delete document.body.dataset.studio;
    document.title = studio ? '创作画布 — 帧外 FRAMEOUT' : '帧外 FRAMEOUT — 让灵感，发生。';
    return () => { delete document.body.dataset.studio; };
  }, [studio]);
  return <>{!studio && <Landing onOpenStudio={openStudio} />}{studioVisited && <Studio onClose={closeStudio} active={studio} />}</>;
}
