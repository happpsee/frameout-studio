(() => {
  const landing = document.getElementById('landing');
  const studioRoot = document.getElementById('studio-root');
  const dialog = document.getElementById('intro-dialog');
  let savedScroll = 0;
  let studioSeen = false;
  let studioOpener = null;
  let toastTimer;
  const fillIcons = (root = document) => root.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = window.FrameoutIcons(el.dataset.icon); });
  window.FrameoutToast = (message) => {
    const toast = document.getElementById('site-toast');
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 3200);
  };
  window.openStudio = (example) => {
    if (!window.FrameoutStudio) { window.FrameoutToast('画布正在准备，请稍后重试。'); return; }
    if (!landing.hidden) {
      savedScroll = window.scrollY;
      studioOpener = document.activeElement;
    }
    const activate = () => {
    dialog.close();
    landing.hidden = true;
    studioRoot.hidden = false;
    document.body.dataset.studio = 'true';
    document.querySelector('.skip-link').hidden = true;
    document.title = '创作画布 — 帧外 FRAMEOUT';
    if (location.hash !== '#studio') history.pushState({studio:true}, '', '#studio');
    if (example && window.FrameoutStudio.loadExample) window.FrameoutStudio.loadExample(example);
    window.dispatchEvent(new Event('resize'));
    if (!studioSeen) {
      studioSeen = true;
      requestAnimationFrame(() => window.FrameoutStudio.enter());
    }
    studioRoot.querySelector('.fo-brand')?.focus({preventScroll:true});
    window.dispatchEvent(new Event('frameout:studiochange'));
    };
    if (!landing.hidden && window.FrameoutMotion) window.FrameoutMotion.transition(activate, 'studio');
    else activate();
  };
  window.closeStudio = () => {
    const activate = () => {
    if (window.FrameoutStudio) window.FrameoutStudio.pause();
    studioRoot.hidden = true;
    landing.hidden = false;
    delete document.body.dataset.studio;
    document.querySelector('.skip-link').hidden = false;
    document.title = '帧外 FRAMEOUT — 让灵感，发生。';
    if (location.hash === '#studio') history.replaceState(null, '', location.pathname + location.search);
    requestAnimationFrame(() => window.scrollTo({top:savedScroll,behavior:'instant'}));
    if (studioOpener?.isConnected) studioOpener.focus({preventScroll:true});
    window.dispatchEvent(new Event('frameout:studiochange'));
    };
    if (!studioRoot.hidden && window.FrameoutMotion) window.FrameoutMotion.transition(activate, 'landing');
    else activate();
  };
  fillIcons();
  if (window.FrameoutStudio) window.FrameoutStudio.mount(studioRoot);
  document.querySelectorAll('.js-open-studio').forEach(button => button.addEventListener('click', () => window.openStudio()));
  document.querySelectorAll('[data-example]').forEach(button => button.addEventListener('click', () => window.openStudio(button.dataset.example)));
  document.getElementById('hero-play').addEventListener('click', () => dialog.showModal());
  document.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
  document.getElementById('intro-to-studio').addEventListener('click', () => window.openStudio());
  dialog.addEventListener('click', event => { if(event.target === dialog) { const r=dialog.getBoundingClientRect(); if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close(); }});
  window.addEventListener('popstate', () => { if(location.hash === '#studio') window.openStudio(); else if(!studioRoot.hidden) window.closeStudio(); });
  if(location.hash === '#studio') window.openStudio();
})();
