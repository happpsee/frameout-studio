(() => {
  'use strict';
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
  const landing = $('#landing');
  if (!landing || !Element.prototype.animate) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
  const small = matchMedia('(max-width: 580px)');
  const clamp = value => Math.max(0, Math.min(1, value));
  const mix = (from, to, value) => from + (to - from) * value;
  const smooth = value => { const x = clamp(value); return x * x * (3 - 2 * x); };
  const ease = 'cubic-bezier(.16,1,.3,1)';
  const heroAnimations = new Set();
  const revealAnimations = new Set();
  let scrollFrame = 0;
  let pointerFrame = 0;
  let activePhase = -1;
  let transitioning = false;
  let entranceGeneration = 0;
  let pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };
  document.documentElement.classList.add('has-motion');

  // Split only display type. Assistive technology reads one complete title.
  const title = $('#hero-title');
  title.setAttribute('aria-label', title.textContent.replace(/\s+/g, ' ').trim().replace('ASCENE', 'A SCENE'));
  $$(':scope > span', title).forEach(line => {
    const text = line.textContent;
    line.classList.add('motion-line');
    line.setAttribute('aria-hidden', 'true');
    line.textContent = '';
    const inner = document.createElement('span');
    inner.className = 'motion-line-inner';
    [...text].forEach(character => {
      const letter = document.createElement('span');
      letter.className = 'motion-letter';
      letter.textContent = character === ' ' ? '\u00a0' : character;
      inner.append(letter);
    });
    line.append(inner);
  });

  function animate(element, frames, timing, collection = heroAnimations) {
    if (!element || reduce.matches) return;
    const animation = element.animate(frames, { fill: 'backwards', easing: ease, ...timing });
    collection.add(animation);
    animation.finished.then(() => collection.delete(animation), () => collection.delete(animation));
    return animation;
  }

  const replay = document.createElement('button');
  replay.type = 'button';
  replay.className = 'motion-replay';
  replay.setAttribute('aria-label', '重新播放首页开场动画');
  replay.innerHTML = '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 7a6 6 0 1 1-1 6M4 2v5h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg><span>重播开场 / REPLAY</span>';
  $('.hero-footnote').replaceWith(replay);

  function playEntrance(withCurtain = false) {
    const generation = ++entranceGeneration;
    heroAnimations.forEach(animation => animation.cancel());
    heroAnimations.clear();
    $('.motion-curtain')?.remove();
    if (reduce.matches || landing.hidden) return;
    let offset = 80;
    if (withCurtain) {
      const curtain = document.createElement('div');
      curtain.className = 'motion-curtain';
      curtain.setAttribute('aria-hidden', 'true');
      curtain.innerHTML = '<div class="motion-curtain-inner"><div class="motion-curtain-title"><span><b>OUTSIDE</b></span><span><b>THE FRAME.</b></span></div><div class="motion-curtain-aside">FRAMEOUT / 帧外<br>A LITTLE WHAT IF.<br>A WHOLE NEW WORLD.</div></div>';
      document.body.append(curtain);
      $$('.motion-curtain-title b', curtain).forEach((line, index) => animate(line, [{ transform: 'translateY(110%)' }, { transform: 'translateY(0)' }], { duration: 650, delay: index * 80 }));
      const animation = animate(curtain, [{ transform: 'translateY(0)' }, { transform: 'translateY(-102%)' }], { delay: 560, duration: 750, fill: 'forwards' });
      animation?.finished.then(() => curtain.remove(), () => curtain.remove());
      offset = 700;
    }
    $$('.motion-letter', title).forEach((letter, index) => {
      animate(letter, [
        { transform: 'translateY(115%) rotate(8deg)', opacity: .2 },
        { transform: 'translateY(0) rotate(0)', opacity: 1 }
      ], { duration: 1050, delay: offset + index * 33 });
    });
    animate($('.hero-outline'), [{ clipPath: 'inset(0 100% 0 0)', opacity: 0 }, { clipPath: 'inset(0 0 0 0)', opacity: 1 }], { duration: 1100, delay: offset + 250 });
    animate($('.hero-photo-frame'), [
      { transform: 'translate(90px,100px) rotate(18deg) scale(.75)', clipPath: 'inset(0 0 100% 0)' },
      { transform: 'translate(0,0) rotate(6deg) scale(1)', clipPath: 'inset(0 0 0 0)' }
    ], { duration: 1250, delay: offset + 150 });
    animate($('.floating-note'), [{ transform: 'translate(-35px,-45px) rotate(-20deg)', opacity: 0 }, { transform: 'translate(0,0) rotate(-8deg)', opacity: 1 }], { duration: 950, delay: offset + 430 });
    animate($('.mini-frame'), [{ transform: 'translate(-55px,70px) rotate(-22deg)', opacity: 0 }, { transform: 'translate(0,0) rotate(-10deg)', opacity: 1 }], { duration: 1000, delay: offset + 510 });
    animate($('.hero-sticker'), [{ transform: 'rotate(-70deg) scale(.2)', opacity: 0 }, { transform: 'rotate(14deg) scale(1)', opacity: 1 }], { duration: 1000, delay: offset + 470 });
    ['.site-header', '.hero-topline', '.hero-description', '.hero-actions', '.hero-footer'].forEach((selector, index) => animate($(selector), [{ transform: selector === '.site-header' || selector === '.hero-actions' ? 'translateY(0)' : 'translateY(20px)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], { duration: 750, delay: offset + index * 110 }));
    // Do not hold the whole site behind fonts or an artificial loading counter.
    if (generation === entranceGeneration) scheduleScroll();
  }
  replay.addEventListener('click', () => {
    if (reduce.matches) return;
    window.scrollTo({ top: 0, behavior: 'instant' });
    playEntrance(false);
  });

  // The same scene moves from exploration into an edit as the page is scrubbed.
  const preview = $('#canvas-preview');
  const stage = document.createElement('div');
  stage.className = 'motion-stage';
  const sticky = document.createElement('div');
  sticky.className = 'motion-sticky';
  preview.before(stage);
  stage.append(sticky);
  sticky.append(preview);
  const status = document.createElement('div');
  status.className = 'motion-story-status';
  status.innerHTML = '<div class="motion-story-heading"><b>01</b><span>先让想法，自由散落。</span></div><div class="motion-story-track" aria-hidden="true"><span>01 / EXPLORE</span><span>02 / FRAME</span><span>03 / SEQUENCE</span></div>';
  sticky.append(status);
  const timeline = document.createElement('div');
  timeline.className = 'motion-timeline';
  timeline.setAttribute('aria-hidden', 'true');
  ['forest-astronaut.png', 'forest-astronaut.png', 'still-ocean.webp'].forEach((source, index) => {
    const shot = document.createElement('div');
    shot.className = 'motion-timeline-shot';
    const image = document.createElement('img');
    image.src = `assets/${source}`;
    image.alt = '';
    image.loading = 'lazy';
    const label = document.createElement('span');
    label.textContent = `0${index + 1} / ${[6, 4, 5][index]}s`;
    shot.append(image, label);
    timeline.append(shot);
  });
  const playhead = document.createElement('i');
  playhead.className = 'motion-playhead';
  timeline.append(playhead);
  $('.preview-body', preview).append(timeline);
  const phaseText = ['先让想法，自由散落。', '找到故事的第一个画面。', '把镜头，连成你的故事。'];
  const progressBar = document.createElement('div');
  progressBar.className = 'motion-scroll-line';
  progressBar.setAttribute('aria-hidden', 'true');
  document.body.append(progressBar);

  function setVariables(element, values) {
    for (const [key, value] of Object.entries(values)) element.style.setProperty(`--${key}`, value);
  }
  function drawScene(progress) {
    const gather = smooth(progress / .48);
    const sequence = smooth((progress - .57) / .37);
    const width = preview.clientWidth;
    const height = $('.preview-body', preview).clientHeight;
    const phoneFactor = small.matches ? .55 : 1;
    setVariables(preview, {
      'main-x': `${mix(-width * .16 * phoneFactor, 0, gather)}px`,
      'main-y': `${mix(height * .17, -height * .045 * sequence, gather)}px`,
      'main-rotate': `${mix(-12, 0, gather)}deg`,
      'main-scale': mix(.85, 1 + .035 * sequence, gather),
      'detail-x': `${mix(width * .12, 0, gather)}px`,
      'detail-y': `${mix(-height * .15, -height * .025 * sequence, gather)}px`,
      'detail-rotate': `${mix(19, 4 - 4 * sequence, gather)}deg`,
      'detail-scale': mix(.82, 1 - .05 * sequence, gather),
      'ocean-x': `${mix(width * .1, 0, gather)}px`,
      'ocean-y': `${mix(height * .2, -height * .05 * sequence, gather)}px`,
      'ocean-rotate': `${mix(-18, -4 + 4 * sequence, gather)}deg`,
      'ocean-scale': mix(.9, 1 - .05 * sequence, gather),
      'pn-x': `${(1 - gather) * -18}px`,
      'pn-y': `${sequence * -12}px`,
      'pn-opacity': 1 - sequence * .65,
      'group-opacity': gather * (1 - sequence * .7),
      'group-scale': mix(.92, 1, gather),
      'cursor-x': `${mix(-width * .1, width * .05, gather)}px`,
      'cursor-y': `${mix(height * .18, -height * .1, gather)}px`,
      'cursor-opacity': gather * (1 - sequence),
      'timeline-y': `${mix(85, 0, sequence)}px`,
      'timeline-opacity': sequence,
      'playhead': `${mix(5, 93, smooth((progress - .77) / .23))}%`
    });
    preview.style.transform = `perspective(1200px) rotateX(${mix(5, 0, gather)}deg) scale(${mix(.94, 1, gather)})`;
    const phase = progress < .3 ? 0 : progress < .66 ? 1 : 2;
    if (phase !== activePhase) {
      activePhase = phase;
      $('.motion-story-heading b', status).textContent = `0${phase + 1}`;
      $('.motion-story-heading>span', status).textContent = phaseText[phase];
      $('.preview-save', preview).lastChild.textContent = [' 给想法留点空间', ' 找到你的主镜头', ' 镜头已连成故事'][phase];
    }
    $$('.motion-story-track>span', status).forEach((element, index) => {
      element.classList.toggle('active', phase === index);
      element.style.setProperty('--phase-fill', clamp((progress - index / 3) * 3));
    });
  }

  function updateScroll() {
    scrollFrame = 0;
    if (landing.hidden || document.hidden) return;
    const viewport = innerHeight;
    const scroll = window.scrollY;
    const fullHeight = document.documentElement.scrollHeight - viewport;
    document.documentElement.style.setProperty('--read-progress', clamp(scroll / Math.max(1, fullHeight)));
    const hero = $('.hero');
    const heroBox = hero.getBoundingClientRect();
    const heroProgress = clamp(-heroBox.top / heroBox.height);
    const marqueeBox = $('.marquee').getBoundingClientRect();
    $('.marquee-track').style.animationPlayState = marqueeBox.top < viewport && marqueeBox.bottom > 0 ? 'running' : 'paused';
    if (!reduce.matches) {
      setVariables(hero, { 'copy-y': `${-heroProgress * 55}px`, 'sticker-rotate': `${heroProgress * 95}deg` });
      const rect = stage.getBoundingClientRect();
      const top = parseFloat(getComputedStyle(sticky).top) || 0;
      const progress = small.matches
        ? clamp((viewport * .85 - rect.top) / Math.max(1, viewport * .9 + rect.height * .25))
        : clamp((top - rect.top) / Math.max(1, rect.height - sticky.offsetHeight));
      drawScene(progress);
      if (heroBox.bottom > 0) setVariables(hero, {'photo-scale': 1.04 + heroProgress * .13, 'photo-x': `${heroProgress * -12}px`});
      $$('.showcase-card').forEach((card, index) => {
        const box = card.getBoundingClientRect();
        if (!small.matches && box.bottom > 0 && box.top < viewport) card.style.setProperty('--card-scroll-y', `${(clamp((viewport - box.top) / (viewport + box.height)) - .5) * (index - 1) * -35}px`);
      });
      const cta = $('.cta-main h2');
      const ctaBox = $('.final-cta').getBoundingClientRect();
      if (ctaBox.bottom > 0 && ctaBox.top < viewport) {
        const p = clamp((viewport - ctaBox.top) / viewport);
        cta.style.translate = `${mix(-45, 0, p)}px 0`;
        cta.style.opacity = mix(.3, 1, p);
      }
    }
  }
  function scheduleScroll() { if (!scrollFrame) scrollFrame = requestAnimationFrame(updateScroll); }
  window.addEventListener('scroll', scheduleScroll, { passive: true });
  window.addEventListener('resize', scheduleScroll, { passive: true });
  small.addEventListener('change', scheduleScroll);

  // Only image layers move; controls stay at their intended hit locations.
  function updatePointer() {
    pointerFrame = 0;
    if (reduce.matches || !finePointer.matches || landing.hidden || document.hidden) return;
    pointer.x += (pointer.targetX - pointer.x) * .075;
    pointer.y += (pointer.targetY - pointer.y) * .075;
    setVariables($('.hero-art'), {
      'art-x': `${pointer.x * 13}px`, 'art-y': `${pointer.y * 11}px`, 'art-rotate': `${pointer.x * 1.2}deg`,
      'note-x': `${pointer.x * -8}px`, 'note-y': `${pointer.y * -7}px`,
      'mini-x': `${pointer.x * -12}px`, 'mini-y': `${pointer.y * -9}px`
    });
    if (Math.abs(pointer.targetX - pointer.x) + Math.abs(pointer.targetY - pointer.y) > .002) pointerFrame = requestAnimationFrame(updatePointer);
  }
  $('.hero').addEventListener('pointermove', event => {
    if (!finePointer.matches || reduce.matches) return;
    const rect = $('.hero').getBoundingClientRect();
    pointer.targetX = ((event.clientX - rect.left) / rect.width - .5) * 2;
    pointer.targetY = ((event.clientY - rect.top) / rect.height - .5) * 2;
    if (!pointerFrame) pointerFrame = requestAnimationFrame(updatePointer);
  });
  $('.hero').addEventListener('pointerleave', () => {
    pointer.targetX = 0; pointer.targetY = 0;
    if (!pointerFrame) pointerFrame = requestAnimationFrame(updatePointer);
  });

  const hoverCursor = document.createElement('div');
  hoverCursor.className = 'motion-showcase-float';
  hoverCursor.setAttribute('aria-hidden', 'true');
  hoverCursor.innerHTML = `EXPLORE ${window.FrameoutIcons('arrow-up-right')}`;
  document.body.append(hoverCursor);
  $$('.showcase-card').forEach(card => {
    card.addEventListener('pointerenter', () => { if (finePointer.matches && !reduce.matches) hoverCursor.classList.add('is-visible'); });
    card.addEventListener('pointermove', event => { hoverCursor.style.transform = `translate(${event.clientX - 55}px,${event.clientY - 55}px)`; });
    card.addEventListener('pointerleave', () => hoverCursor.classList.remove('is-visible'));
    card.addEventListener('click', () => hoverCursor.classList.remove('is-visible'));
  });

  // Reveal compositions once, with their own mask and rhythm, rather than moving
  // the document itself or replacing native scrolling with a simulated camera.
  const revealTargets = [
    ...$$('.section-heading'), ...$$('.process-list article'),
    ...$$('.showcase-card'), $('.cta-topline'), $('.cta-main'), $('.cta-bottom')
  ].filter(Boolean);
  const revealObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting || landing.hidden) continue;
      revealObserver.unobserve(entry.target);
      if (reduce.matches) continue;
      const isCard = entry.target.matches('.showcase-card');
      animate(entry.target, isCard ? [
        { clipPath: 'inset(0 0 100% 0)', transform: 'translateY(60px)' },
        { clipPath: 'inset(0 0 0 0)', transform: 'translateY(0)' }
      ] : [{ opacity: 0, transform: 'translateY(45px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: isCard ? 1150 : 850, delay: isCard ? $$('.showcase-card').indexOf(entry.target) * 90 : 0 }, revealAnimations);
    }
  }, { threshold: .12 });
  revealTargets.forEach(element => revealObserver.observe(element));
  const visibilityObserver = new IntersectionObserver(entries => entries.forEach(entry => {
    $$('.marquee-track', entry.target).forEach(track => { track.style.animationPlayState = entry.isIntersecting && !landing.hidden && !document.hidden ? 'running' : 'paused'; });
  }));
  visibilityObserver.observe($('.marquee'));

  // A quick two-panel wipe preserves one visual language between site and tool.
  window.FrameoutMotion = {
    transition(commit, mode = 'studio') {
      if (transitioning) return;
      if (reduce.matches || document.hidden) { commit(); return; }
      transitioning = true;
      hoverCursor.classList.remove('is-visible');
      const wipe = document.createElement('div');
      wipe.className = 'motion-wipe';
      wipe.setAttribute('aria-hidden', 'true');
      wipe.innerHTML = `<div></div><div></div><span class="motion-wipe-label">${mode === 'studio' ? 'MAKE A SCENE.' : 'KEEP EXPLORING.'}</span>`;
      document.body.append(wipe);
      // Block a second click only during the short close/open transition.
      wipe.style.pointerEvents = 'auto';
      const panels = $$(':scope > div', wipe);
      const closeAnimations = panels.map((panel, index) => panel.animate([{ transform: 'translateY(105%)' }, { transform: 'translateY(0)' }], { duration: 370, delay: index * 55, fill: 'forwards', easing: ease }));
      Promise.all(closeAnimations.map(animation => animation.finished)).then(() => {
        commit();
        $('.motion-wipe-label', wipe).animate([{ opacity: 0 }, { opacity: 1 }, { opacity: 0 }], { duration: 440 });
        const opens = panels.map((panel, index) => panel.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-105%)' }], { duration: 600, delay: 75 + index * 45, fill: 'forwards', easing: ease }));
        return Promise.all(opens.map(animation => animation.finished));
      }).catch(error => console.error('FRAMEOUT 页面转场失败', error)).finally(() => { wipe.remove(); transitioning = false; scheduleScroll(); });
    }
  };
  function handlePreference() {
    if (reduce.matches) {
      heroAnimations.forEach(animation => animation.cancel());
      revealAnimations.forEach(animation => animation.cancel());
      $('.motion-curtain')?.remove();
      preview.removeAttribute('style');
      $$('.showcase-card,.cta-main h2,.hero').forEach(element => element.removeAttribute('style'));
    }
    scheduleScroll();
  }
  reduce.addEventListener('change', handlePreference);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(pointerFrame); pointerFrame = 0;
      $('.marquee-track').style.animationPlayState = 'paused';
    } else scheduleScroll();
  });
  window.addEventListener('frameout:studiochange', () => {
    if (landing.hidden) {
      cancelAnimationFrame(pointerFrame); pointerFrame = 0;
      $('.marquee-track').style.animationPlayState = 'paused';
    }
    scheduleScroll();
  });
  playEntrance(!landing.hidden && window.scrollY < 80);
  scheduleScroll();
})();
