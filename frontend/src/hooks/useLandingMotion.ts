import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const mix = (from: number, to: number, progress: number) => from + (to - from) * progress;
const smooth = (value: number) => { const x = clamp(value); return x * x * (3 - 2 * x); };

/** Only animation styles use DOM refs; page content and phase labels stay in React. */
export function useLandingMotion(rootRef: RefObject<HTMLDivElement | null>) {
  const playRef = useRef<() => void>(() => {});
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const query = <T extends HTMLElement = HTMLElement>(selector: string) => root.querySelector<T>(selector);
    const all = (selector: string) => Array.from(root.querySelectorAll<HTMLElement>(selector));
    const hero = query('.hero');
    const art = query('.hero-art');
    const preview = query('.canvas-preview');
    const stage = query('.motion-stage');
    const sticky = query('.motion-sticky');
    const marquee = query('.marquee-track');
    if (!hero || !art || !preview || !stage || !sticky || !marquee) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
    const small = window.matchMedia('(max-width: 580px)');
    const heroAnimations = new Set<Animation>();
    const revealAnimations = new Set<Animation>();
    const cleanup: (() => void)[] = [];
    let scrollFrame = 0;
    let pointerFrame = 0;
    let disposed = false;
    let currentPhase = -1;
    const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };
    root.classList.add('has-motion');

    function variables(element: HTMLElement, values: Record<string, number | string>) {
      for (const [name, value] of Object.entries(values)) element.style.setProperty(`--${name}`, String(value));
    }

    function animate(element: HTMLElement | null, frames: Keyframe[], options: KeyframeAnimationOptions, collection = heroAnimations) {
      if (!element || reduced.matches || !element.animate || disposed) return;
      const animation = element.animate(frames, { fill: 'backwards', easing: 'cubic-bezier(.16,1,.3,1)', ...options });
      collection.add(animation);
      animation.finished.then(() => collection.delete(animation), () => collection.delete(animation));
    }

    function entrance() {
      heroAnimations.forEach(animation => animation.cancel());
      heroAnimations.clear();
      if (reduced.matches || document.hidden) return;
      all('.motion-letter').forEach((letter, index) => animate(letter, [
        { transform: 'translateY(115%) rotate(8deg)', opacity: 0.2 },
        { transform: 'translateY(0) rotate(0)', opacity: 1 },
      ], { duration: 1050, delay: 80 + index * 33 }));
      animate(query('.hero-outline'), [{ clipPath: 'inset(0 100% 0 0)', opacity: 0 }, { clipPath: 'inset(0)', opacity: 1 }], { duration: 1100, delay: 330 });
      animate(query('.hero-photo-frame'), [
        { transform: 'translate(90px,100px) rotate(18deg) scale(.75)', clipPath: 'inset(0 0 100% 0)' },
        { transform: 'translate(0,0) rotate(6deg) scale(1)', clipPath: 'inset(0)' },
      ], { duration: 1250, delay: 230 });
      animate(query('.floating-note'), [{ transform: 'translate(-35px,-45px) rotate(-20deg)', opacity: 0 }, { transform: 'translate(0,0) rotate(-8deg)', opacity: 1 }], { duration: 950, delay: 510 });
      animate(query('.mini-frame'), [{ transform: 'translate(-55px,70px) rotate(-22deg)', opacity: 0 }, { transform: 'translate(0,0) rotate(-10deg)', opacity: 1 }], { duration: 1000, delay: 590 });
      animate(query('.hero-sticker'), [{ transform: 'rotate(-70deg) scale(.2)', opacity: 0 }, { transform: 'rotate(14deg) scale(1)', opacity: 1 }], { duration: 1000, delay: 550 });
      ['.site-header', '.hero-topline', '.hero-description', '.hero-actions', '.hero-footer'].forEach((selector, index) => animate(query(selector), [{ transform: 'translateY(20px)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], { duration: 750, delay: 80 + index * 110 }));
      scheduleScroll();
    }
    playRef.current = entrance;

    function drawScene(progress: number) {
      if (!preview) return;
      const gather = smooth(progress / 0.48);
      const sequence = smooth((progress - 0.57) / 0.37);
      const width = preview.clientWidth;
      const height = query('.preview-body')?.clientHeight ?? 400;
      const phoneFactor = small.matches ? 0.55 : 1;
      variables(preview, {
        'main-x': `${mix(-width * 0.16 * phoneFactor, 0, gather)}px`,
        'main-y': `${mix(height * 0.17, -height * 0.045 * sequence, gather)}px`,
        'main-rotate': `${mix(-12, 0, gather)}deg`, 'main-scale': mix(0.85, 1 + 0.035 * sequence, gather),
        'detail-x': `${mix(width * 0.12, 0, gather)}px`,
        'detail-y': `${mix(-height * 0.15, -height * 0.025 * sequence, gather)}px`,
        'detail-rotate': `${mix(19, 4 - 4 * sequence, gather)}deg`, 'detail-scale': mix(0.82, 1 - 0.05 * sequence, gather),
        'ocean-x': `${mix(width * 0.1, 0, gather)}px`,
        'ocean-y': `${mix(height * 0.2, -height * 0.05 * sequence, gather)}px`,
        'ocean-rotate': `${mix(-18, -4 + 4 * sequence, gather)}deg`, 'ocean-scale': mix(0.9, 1 - 0.05 * sequence, gather),
        'pn-x': `${(1 - gather) * -18}px`, 'pn-y': `${sequence * -12}px`, 'pn-opacity': 1 - sequence * 0.65,
        'group-opacity': gather * (1 - sequence * 0.7), 'group-scale': mix(0.92, 1, gather),
        'cursor-x': `${mix(-width * 0.1, width * 0.05, gather)}px`,
        'cursor-y': `${mix(height * 0.18, -height * 0.1, gather)}px`, 'cursor-opacity': gather * (1 - sequence),
        'timeline-y': `${mix(85, 0, sequence)}px`, 'timeline-opacity': sequence,
        playhead: `${mix(5, 93, smooth((progress - 0.77) / 0.23))}%`,
      });
      preview.style.transform = `perspective(1200px) rotateX(${mix(5, 0, gather)}deg) scale(${mix(0.94, 1, gather)})`;
      const nextPhase = progress < 0.3 ? 0 : progress < 0.66 ? 1 : 2;
      if (nextPhase !== currentPhase) { currentPhase = nextPhase; setPhase(nextPhase); }
      all('.motion-story-track>span').forEach((item, index) => item.style.setProperty('--phase-fill', String(clamp((progress - index / 3) * 3))));
    }

    function updateScroll() {
      scrollFrame = 0;
      if (disposed || document.hidden || !hero || !stage || !sticky || !preview || !marquee) return;
      const viewport = window.innerHeight;
      variables(root!, { 'read-progress': clamp(window.scrollY / Math.max(1, document.documentElement.scrollHeight - viewport)) });
      const marqueeBox = marquee.getBoundingClientRect();
      marquee.style.animationPlayState = !reduced.matches && marqueeBox.top < viewport && marqueeBox.bottom > 0 ? 'running' : 'paused';
      if (reduced.matches) return;
      const heroBox = hero.getBoundingClientRect();
      const heroProgress = clamp(-heroBox.top / Math.max(1, heroBox.height));
      variables(hero, { 'copy-y': `${-heroProgress * 55}px`, 'sticker-rotate': `${heroProgress * 95}deg` });
      if (heroBox.bottom > 0) variables(hero, { 'photo-scale': 1.04 + heroProgress * 0.13, 'photo-x': `${heroProgress * -12}px` });
      const box = stage.getBoundingClientRect();
      const stickyTop = parseFloat(getComputedStyle(sticky).top) || 0;
      const progress = small.matches
        ? clamp((viewport * 0.85 - box.top) / Math.max(1, viewport * 0.9 + box.height * 0.25))
        : clamp((stickyTop - box.top) / Math.max(1, box.height - sticky.offsetHeight));
      drawScene(progress);
      all('.showcase-card').forEach((card, index) => {
        const cardBox = card.getBoundingClientRect();
        if (!small.matches && cardBox.bottom > 0 && cardBox.top < viewport) card.style.setProperty('--card-scroll-y', `${(clamp((viewport - cardBox.top) / (viewport + cardBox.height)) - 0.5) * (index - 1) * -35}px`);
      });
      const cta = query('.cta-main h2');
      const ctaBox = query('.final-cta')?.getBoundingClientRect();
      if (cta && ctaBox && ctaBox.bottom > 0 && ctaBox.top < viewport) {
        const p = clamp((viewport - ctaBox.top) / viewport);
        cta.style.translate = `${mix(-45, 0, p)}px 0`;
        cta.style.opacity = String(mix(0.3, 1, p));
      }
    }
    function scheduleScroll() { if (!scrollFrame && !disposed) scrollFrame = requestAnimationFrame(updateScroll); }

    function updatePointer() {
      pointerFrame = 0;
      if (disposed || reduced.matches || !fine.matches || document.hidden || !art) return;
      pointer.x += (pointer.targetX - pointer.x) * 0.075;
      pointer.y += (pointer.targetY - pointer.y) * 0.075;
      variables(art, {
        'art-x': `${pointer.x * 13}px`, 'art-y': `${pointer.y * 11}px`, 'art-rotate': `${pointer.x * 1.2}deg`,
        'note-x': `${pointer.x * -8}px`, 'note-y': `${pointer.y * -7}px`,
        'mini-x': `${pointer.x * -12}px`, 'mini-y': `${pointer.y * -9}px`,
      });
      if (Math.abs(pointer.targetX - pointer.x) + Math.abs(pointer.targetY - pointer.y) > 0.002) pointerFrame = requestAnimationFrame(updatePointer);
    }
    const pointerMove = (event: PointerEvent) => {
      if (!fine.matches || reduced.matches) return;
      const box = hero.getBoundingClientRect();
      pointer.targetX = ((event.clientX - box.left) / box.width - 0.5) * 2;
      pointer.targetY = ((event.clientY - box.top) / box.height - 0.5) * 2;
      if (!pointerFrame) pointerFrame = requestAnimationFrame(updatePointer);
    };
    const pointerLeave = () => {
      pointer.targetX = pointer.targetY = 0;
      if (!pointerFrame) pointerFrame = requestAnimationFrame(updatePointer);
    };
    hero.addEventListener('pointermove', pointerMove);
    hero.addEventListener('pointerleave', pointerLeave);
    cleanup.push(() => { hero.removeEventListener('pointermove', pointerMove); hero.removeEventListener('pointerleave', pointerLeave); });

    const reveals = all('.section-heading,.process-list article,.showcase-card,.cta-topline,.cta-main,.cta-bottom');
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        observer.unobserve(entry.target);
        if (reduced.matches) return;
        const element = entry.target as HTMLElement;
        const isCard = element.matches('.showcase-card');
        animate(element, isCard ? [{ clipPath: 'inset(0 0 100% 0)', transform: 'translateY(60px)' }, { clipPath: 'inset(0)', transform: 'translateY(0)' }] : [{ opacity: 0, transform: 'translateY(45px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: isCard ? 1150 : 850, delay: isCard ? all('.showcase-card').indexOf(element) * 90 : 0 }, revealAnimations);
      });
    }, { threshold: 0.12 });
    reveals.forEach(element => observer.observe(element));

    const preferenceChange = () => {
      if (reduced.matches) {
        heroAnimations.forEach(animation => animation.cancel());
        revealAnimations.forEach(animation => animation.cancel());
        all('.canvas-preview,.hero,.hero-art,.showcase-card,.cta-main h2').forEach(element => element.removeAttribute('style'));
        cancelAnimationFrame(pointerFrame); pointerFrame = 0;
      }
      scheduleScroll();
    };
    const visibilityChange = () => {
      if (document.hidden) { cancelAnimationFrame(pointerFrame); pointerFrame = 0; marquee.style.animationPlayState = 'paused'; }
      else scheduleScroll();
    };
    window.addEventListener('scroll', scheduleScroll, { passive: true });
    window.addEventListener('resize', scheduleScroll, { passive: true });
    reduced.addEventListener('change', preferenceChange);
    small.addEventListener('change', scheduleScroll);
    document.addEventListener('visibilitychange', visibilityChange);
    const initialFrame = requestAnimationFrame(entrance);
    scheduleScroll();

    return () => {
      disposed = true;
      playRef.current = () => {};
      cancelAnimationFrame(initialFrame);
      cancelAnimationFrame(scrollFrame);
      cancelAnimationFrame(pointerFrame);
      heroAnimations.forEach(animation => animation.cancel());
      revealAnimations.forEach(animation => animation.cancel());
      observer.disconnect();
      cleanup.forEach(remove => remove());
      window.removeEventListener('scroll', scheduleScroll);
      window.removeEventListener('resize', scheduleScroll);
      reduced.removeEventListener('change', preferenceChange);
      small.removeEventListener('change', scheduleScroll);
      document.removeEventListener('visibilitychange', visibilityChange);
      root.classList.remove('has-motion');
      root.style.removeProperty('--read-progress');
    };
  }, [rootRef]);

  const replayEntrance = useCallback(() => playRef.current(), []);
  return { replayEntrance, phase };
}
