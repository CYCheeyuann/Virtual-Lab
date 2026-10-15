(function () {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const CAMERA_FRAMES = [
    { id: 'basecamp', x: 42, y: 13, scale: 1.62, label: 'Open Sky · Basecamp', coordinates: '04° SKY / ALT 01', brightness: .76 },
    { id: 'rainforest', x: 10, y: 73, scale: 2.18, label: 'Rainforest · Biology Station', coordinates: '11° FLORA / BIO 02', brightness: .7 },
    { id: 'river', x: 51, y: 79, scale: 2.3, label: 'Crystal River · Chemistry', coordinates: '27° AQUA / CHEM 03', brightness: .72 },
    { id: 'mountain', x: 68, y: 56, scale: 2.12, label: 'Volcanic Ridge · Physics', coordinates: '58° RIDGE / PHY 04', brightness: .68 },
    { id: 'summit', x: 50, y: 50, scale: 1, label: 'Complete Expedition · Base View', coordinates: '00° HOME / FIELD 05', brightness: .72 }
  ];

  function setupWelcomeCinematic() {
    const hero = document.querySelector('.expedition-hero');
    const image = document.querySelector('[data-cinematic-media] img');
    const progress = document.getElementById('journeyProgress');
    const rail = document.querySelector('.journey-rail');
    const stops = Array.from(document.querySelectorAll('[data-journey-stop]'));
    const camera = document.querySelector('[data-journey-camera]');
    const cameraMotion = camera && camera.querySelector('.journey-camera-motion');
    const cameraLocation = document.getElementById('cameraLocation');
    const cameraCoordinates = document.getElementById('cameraCoordinates');
    if (!hero) return;

    const syncBannerOffset = () => {
      const banner = document.getElementById('demo-mode-banner');
      const navbar = document.querySelector('.expedition-nav');
      const offset = banner ? Math.ceil(banner.getBoundingClientRect().height) : 0;
      if (navbar) navbar.style.top = `${offset}px`;
      if (progress) progress.style.top = `${offset}px`;
    };
    syncBannerOffset();
    window.addEventListener('resize', syncBannerOffset, { passive: true });

    let ticking = false;
    let activeFrameId = null;
    let arrivalTimer = null;
    const cameraMoveMs = reduceMotion ? 0 : 1250;

    // RISK ANALYSIS (not a confirmed root cause — needs on-device repro):
    // the big per-stop zoom (up to ~2.3x) on a sticky, 100svh, negative-margin
    // layer is a plausible source of the reported mobile jump / over-zoom /
    // black edges, especially as the address bar resizes. As a conservative
    // mitigation we keep a stable scale(1) cover background on phones and skip
    // the camera moves; scroll progress, the rail, and chapter-arrived reveals
    // still run. Desktop keeps the full cinematic. Effectiveness to be
    // confirmed in a real mobile browser.
    // "Mobile view" = narrow portrait phones OR short, coarse-pointer phones in
    // landscape (e.g. 844×390). Using height + pointer catches landscape phones
    // that are wider than 600px but are still phones, so they don't fall back
    // into the heavy desktop cinematic. Desktop (fine pointer, tall) is excluded.
    const mqMobile = window.matchMedia(
      '(max-width: 600px), (max-height: 600px) and (pointer: coarse)'
    );
    const isMobileView = () => mqMobile.matches;

    const clearChapterStates = () => {
      stops.forEach((section) => section.classList.remove('camera-active', 'camera-arrived'));
    };

    const resetCamera = () => {
      if (!cameraMotion || activeFrameId === null) return;
      window.clearTimeout(arrivalTimer);
      activeFrameId = null;
      clearChapterStates();
      camera.classList.remove('is-moving', 'has-arrived');
      delete camera.dataset.scene;
      cameraMotion.style.transformOrigin = '50% 50%';
      cameraMotion.style.transform = 'scale(1)';
      cameraMotion.style.filter = 'saturate(.88) contrast(1.08) brightness(.78)';
    };

    const moveCameraTo = (frame) => {
      if (!cameraMotion || !frame || activeFrameId === frame.id) return;
      window.clearTimeout(arrivalTimer);
      activeFrameId = frame.id;
      clearChapterStates();

      const section = document.getElementById(frame.id);
      if (section) section.classList.add('camera-active');
      camera.classList.add('is-moving');
      camera.classList.remove('has-arrived');
      camera.dataset.scene = frame.id;
      cameraMotion.style.transformOrigin = `${frame.x}% ${frame.y}%`;
      cameraMotion.style.transform = `scale(${frame.scale})`;
      cameraMotion.style.filter = `saturate(.9) contrast(1.08) brightness(${frame.brightness})`;
      if (cameraLocation) cameraLocation.textContent = frame.label;
      if (cameraCoordinates) cameraCoordinates.textContent = frame.coordinates;

      let arrived = false;
      const arrive = () => {
        if (arrived) return;
        if (activeFrameId !== frame.id) return;
        arrived = true;
        window.clearTimeout(arrivalTimer);
        camera.classList.remove('is-moving');
        camera.classList.add('has-arrived');
        if (section) section.classList.add('camera-arrived');
      };
      arrivalTimer = window.setTimeout(arrive, cameraMoveMs);

    };

    // Pin the background to a steady, full-cover scale(1) with no transform
    // origin shifts — used on mobile and when motion is reduced.
    const stabilizeCamera = () => {
      if (!cameraMotion) return;
      window.clearTimeout(arrivalTimer);
      activeFrameId = null;
      camera.classList.remove('is-moving');
      camera.classList.add('has-arrived');
      cameraMotion.style.transformOrigin = '50% 50%';
      cameraMotion.style.transform = 'scale(1)';
      cameraMotion.style.filter = 'saturate(.9) contrast(1.06) brightness(.72)';
    };

    const updateCamera = (top) => {
      if (!cameraMotion) return;
      // Mobile: never run the zoom/pan camera — keep a stable cover and just
      // mark the nearest stop arrived so chapter copy/filters stay consistent.
      if (isMobileView()) {
        stabilizeCamera();
        stops.forEach((s) => s.classList.toggle('camera-arrived',
          s.getBoundingClientRect().top < window.innerHeight * 0.75));
        return;
      }
      if (top < hero.offsetHeight * .94) {
        resetCamera();
        return;
      }

      const candidates = CAMERA_FRAMES.map((frame) => {
        const section = document.getElementById(frame.id);
        if (!section) return null;
        const rect = section.getBoundingClientRect();
        return { frame, rect, distance: Math.abs((rect.top + rect.bottom) * .5 - window.innerHeight * .5) };
      }).filter(Boolean).filter(({ rect }) => rect.top <= window.innerHeight * .58 && rect.bottom >= window.innerHeight * .42);

      if (!candidates.length) return;
      candidates.sort((a, b) => a.distance - b.distance);
      moveCameraTo(candidates[0].frame);
    };

    const update = () => {
      const top = window.scrollY;
      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      if (progress) progress.style.width = `${Math.min(100, (top / max) * 100)}%`;
      if (rail) rail.classList.toggle('is-visible', top > hero.offsetHeight * .72 && top < max - window.innerHeight * .5);
      // Hero parallax runs on desktop only; on mobile a steady image avoids
      // the jump/crop when the address bar grows and shrinks.
      if (image && !reduceMotion && !isMobileView() && top < hero.offsetHeight * 1.2) {
        image.style.transform = `scale(${1.04 + Math.min(top / hero.offsetHeight, 1) * .08}) translate3d(0, ${top * .075}px, 0)`;
      } else if (image && isMobileView()) {
        image.style.transform = '';
      }
      updateCamera(top);
      ticking = false;
    };
    window.addEventListener('scroll', () => {
      if (!ticking) { window.requestAnimationFrame(update); ticking = true; }
    }, { passive: true });
    update();

    // Re-evaluate framing when the viewport changes size or orientation — not
    // just the banner offset. Crossing the mobile/desktop breakpoint flips the
    // camera between stable-cover and cinematic cleanly.
    const onViewportChange = () => {
      if (isMobileView()) stabilizeCamera();
      else { activeFrameId = null; }   // force desktop re-frame on next scroll
      if (!ticking) { window.requestAnimationFrame(update); ticking = true; }
    };
    window.addEventListener('resize', onViewportChange, { passive: true });
    window.addEventListener('orientationchange', onViewportChange, { passive: true });

    if ('IntersectionObserver' in window && stops.length) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          document.querySelectorAll('.rail-stop').forEach((item) => {
            item.classList.toggle('active', item.getAttribute('href') === `#${entry.target.id}`);
          });
        });
      }, { threshold: .42 });
      stops.forEach((stop) => observer.observe(stop));
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    setupWelcomeCinematic();
  });
})();
