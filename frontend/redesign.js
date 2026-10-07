(function () {
  'use strict';

  const PAGE_LABELS = {
    'index.html': 'Expedition Control',
    'chapter.html': 'Knowledge Field Map',
    'experiment.html': 'Research Protocol',
    'quiz.html': 'Understanding Checkpoint',
    'flashcards.html': 'Memory Field Kit',
    'lab-tools.html': 'Scientific Toolkit',
    'tutor.html': 'AI Research Companion'
  };

  function currentFile() {
    return window.location.pathname.split('/').pop() || 'welcome.html';
  }

  function enhanceBrand() {
    document.querySelectorAll('.brand').forEach((brand) => {
      if (brand.querySelector('.brand-mark')) return;
      Array.from(brand.childNodes).forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          node.nodeValue = node.nodeValue.replace(/^\s*(?:\p{Extended_Pictographic}\uFE0F?)+\s*/u, '');
        }
      });
      const mark = document.createElement('span');
      mark.className = 'brand-mark';
      mark.setAttribute('aria-hidden', 'true');
      mark.innerHTML = '<i></i>';
      brand.prepend(mark);
    });
  }

  function setupNavigation() {
    const navbar = document.querySelector('.navbar');
    const nav = navbar && navbar.querySelector('.nav-links');
    const inner = navbar && navbar.querySelector('.nav-inner');
    if (!navbar || !nav || !inner) return;

    if (!inner.querySelector('.nav-toggle')) {
      const toggle = document.createElement('button');
      toggle.className = 'nav-toggle';
      toggle.type = 'button';
      toggle.setAttribute('aria-label', 'Open navigation');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.innerHTML = '<span></span>';
      inner.insertBefore(toggle, nav);

      const close = () => {
        nav.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-label', 'Open navigation');
      };

      toggle.addEventListener('click', () => {
        const open = !nav.classList.contains('is-open');
        nav.classList.toggle('is-open', open);
        toggle.setAttribute('aria-expanded', String(open));
        toggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
      });
      nav.addEventListener('click', (event) => {
        if (event.target.closest('a')) close();
      });
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') close();
      });
      document.addEventListener('click', (event) => {
        if (!navbar.contains(event.target)) close();
      });
    }

    const file = currentFile();
    nav.querySelectorAll('a[href]').forEach((link) => {
      const hrefFile = link.getAttribute('href').split('#')[0];
      if (hrefFile === file && file !== 'welcome.html') link.classList.add('active');
    });

    const onScroll = () => navbar.classList.toggle('is-scrolled', window.scrollY > 18);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  function enhancePageHeader() {
    if (document.body.classList.contains('expedition-page')) return;
    const file = currentFile();
    const header = document.querySelector('.page-header');
    if (!header || header.querySelector('.page-eyebrow')) return;
    const label = document.createElement('p');
    label.className = 'page-eyebrow';
    label.textContent = PAGE_LABELS[file] || 'Virtual Science Lab';
    header.prepend(label);
    document.body.dataset.page = file.replace('.html', '');
  }

  function setupReveals() {
    const targets = document.querySelectorAll('.reveal, body:not(.expedition-page) .page-header, body:not(.expedition-page) .card, body:not(.expedition-page) .tile');
    targets.forEach((el) => el.classList.add('reveal'));

    if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      targets.forEach((el) => el.classList.add('is-visible'));
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -25px' });

    targets.forEach((el, index) => {
      if (!el.style.transitionDelay && index < 10) el.style.transitionDelay = `${Math.min(index % 5, 4) * 55}ms`;
      observer.observe(el);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    enhanceBrand();
    setupNavigation();
    enhancePageHeader();
    setupReveals();
  });
})();
