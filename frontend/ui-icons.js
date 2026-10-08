(function () {
  'use strict';

  const paths = {
    atom: '<circle cx="12" cy="12" r="2"/><ellipse cx="12" cy="12" rx="9" ry="3.5"/><ellipse cx="12" cy="12" rx="9" ry="3.5" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="3.5" transform="rotate(120 12 12)"/>',
    chart: '<path d="M4 19V9m6 10V5m6 14v-7m4 7H2"/>',
    flame: '<path d="M12 22c4.4 0 7-3.1 7-7.2 0-3.4-2-6.7-5.4-9.8.1 2.5-.8 4.2-2.4 5.3.1-3.5-1.7-6.1-4.2-8.3.2 3.6-2 5.8-2 9.1C5 17.4 7.8 22 12 22Z"/><path d="M9.4 17.2c0-1.8 1.1-3.2 2.9-4.7 0 1.7 1.4 2.6 1.4 4.4 0 1.6-.8 2.8-2.2 2.8-1.2 0-2.1-1-2.1-2.5Z"/>',
    note: '<path d="M5 3h10l4 4v14H5z"/><path d="M15 3v5h5M8 12h8M8 16h5"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="m15 9 6-6m-3 0h3v3"/>',
    bot: '<rect x="4" y="7" width="16" height="13" rx="4"/><path d="M9 3h6M12 3v4M8 12h.01M16 12h.01M8 16c2.5 1.3 5.5 1.3 8 0"/>',
    calculator: '<rect x="4" y="2.5" width="16" height="19" rx="3"/><path d="M7.5 6h9v3h-9zM8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01M16 17h.01"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
    book: '<path d="M3 4h6a3 3 0 0 1 3 3v13a3 3 0 0 0-3-3H3zM21 4h-6a3 3 0 0 0-3 3v13a3 3 0 0 1 3-3h6z"/>',
    microscope: '<path d="m9 3 4 4-3 3-4-4zM11.5 8.5l3.8 3.8M7 13a6 6 0 0 0 10 4M5 21h14M15 12l2-2 2 2-2 2z"/>',
    flask: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-9V3M7.5 15h9"/>',
    brain: '<path d="M9.5 4.5A3 3 0 0 0 5 7a3 3 0 0 0-1 5.5A3.5 3.5 0 0 0 8 18v2M14.5 4.5A3 3 0 0 1 19 7a3 3 0 0 1 1 5.5 3.5 3.5 0 0 1-4 5.5v2M12 3v18M8 9h4M12 14h4"/>',
    tools: '<path d="M14.7 6.3a5 5 0 0 0-6.3 6.3L3 18l3 3 5.4-5.4a5 5 0 0 0 6.3-6.3l-3 3-3-3z"/>',
    warning: '<path d="M12 3 2.8 20h18.4z"/><path d="M12 9v5M12 17h.01"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 2.6 2.6L16.5 9"/>',
    close: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
    paperclip: '<path d="m8 12 6.5-6.5a3 3 0 0 1 4.2 4.2l-8.5 8.5a5 5 0 0 1-7.1-7.1l8-8"/>',
    file: '<path d="M5 3h10l4 4v14H5z"/><path d="M15 3v5h5"/>',
    rocket: '<path d="M14 4c3-2 5-2 6-2 0 1 0 3-2 6l-5 5-4-4zM9 9 5 8l-3 3 5 2M13 13l1 5-3 3-2-5M7 17l-3 3"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m5 18 5-5 3 3 2-2 4 4"/>',
    bolt: '<path d="m13 2-8 12h7l-1 8 8-12h-7z"/>',
    shield: '<path d="M12 3 5 6v5c0 4.6 2.8 8 7 10 4.2-2 7-5.4 7-10V6z"/><path d="m9 12 2 2 4-4"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/>',
    spark: '<path d="M12 2v5M12 17v5M2 12h5M17 12h5M5 5l3.5 3.5M15.5 15.5 19 19M19 5l-3.5 3.5M8.5 15.5 5 19"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>',
    clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M9 9h6M9 13h6M9 17h4"/>',
    bulb: '<path d="M8.5 15.5A7 7 0 1 1 15.5 15.5L14 17H10zM10 21h4M10 18h4"/>',
    pin: '<path d="m8 3 8 8M7 8l5-5 5 5-3 3 2 5-1 1-5-2-3 3-1-1 3-3zM8 16l-5 5"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"/>',
    thumbsUp: '<path d="M7 10v10H3V10zM7 18c2 2 8 2 10 1l2-7a2 2 0 0 0-2-2h-4l1-5c0-2-3-2-3 0l-4 5"/>',
    thumbsDown: '<path d="M7 14V4H3v10zM7 6c2-2 8-2 10-1l2 7a2 2 0 0 1-2 2h-4l1 5c0 2-3 2-3 0l-4-5"/>',
    leaf: '<path d="M20 4C11 4 5 8 4 18c5 3 10 1 13-3 3-4 3-8 3-11Z"/><path d="M5 19c4-6 8-9 14-13"/>',
    dna: '<path d="M7 3c0 6 10 12 10 18M17 3C17 9 7 15 7 21M8 7h8M7 12h10M8 17h8"/>',
    planet: '<circle cx="12" cy="12" r="4"/><path d="M3 14c2 3 8 2 13-1s7-7 5-9c-1-1-4 0-6 1M9 19c-3 1-6 1-7-1"/>',
    thermometer: '<path d="M9 15.5V5a3 3 0 0 1 6 0v10.5a5 5 0 1 1-6 0Z"/><path d="M12 8v9"/>',
    ruler: '<path d="m4 16 12-12 4 4L8 20z"/><path d="m13 7 2 2m-5 1 2 2m-5 1 2 2"/>',
    scale: '<path d="M12 3v18M5 6h14M4 6l-3 7h6zM20 6l-3 7h6zM8 21h8"/>',
    cube: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9"/>',
    wind: '<path d="M3 8h11c4 0 4-5 1-5-2 0-3 1-3 2M3 12h16c4 0 4 5 1 5-2 0-3-1-3-2M3 16h8"/>',
    play: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m10 9 5 3-5 3z"/>',
    send: '<path d="m3 11 18-8-8 18-2-7zM11 14l4-4"/>'
  };

  const tokenMap = new Map([
    ['📊','chart'],['🔥','flame'],['📝','note'],['🎯','target'],['🤖','bot'],['🧮','calculator'],['💬','chat'],['📖','book'],['📚','book'],
    ['🔬','microscope'],['🧪','flask'],['⚗️','flask'],['⚗','flask'],['🧠','brain'],['🧰','tools'],['⚠️','warning'],['⚠','warning'],
    ['✅','check'],['❌','close'],['ℹ️','info'],['ℹ','info'],['📎','paperclip'],['📄','file'],['🚀','rocket'],['🌍','globe'],
    ['🖼️','image'],['🖼','image'],['🎨','image'],['⚡','bolt'],['🦺','shield'],['🗑️','trash'],['🗑','trash'],['👋','spark'],
    ['🔍','search'],['📋','clipboard'],['💡','bulb'],['📌','pin'],['🔒','lock'],['⭐','star'],['☆','star'],['👍','thumbsUp'],['👎','thumbsDown'],
    ['🧬','dna'],['🌿','leaf'],['🍃','leaf'],['🌱','leaf'],['🦠','atom'],['🧫','flask'],['⚛️','atom'],['⚛','atom'],['💊','file'],
    ['🔭','microscope'],['🌌','star'],['🪐','planet'],['🛰️','planet'],['🛰','planet'],['🌡️','thermometer'],['🌡','thermometer'],
    ['📏','ruler'],['⚖️','scale'],['⚖','scale'],['📦','cube'],['💨','wind'],['😅','info'],['🎬','play'],['🚨','warning'],['➤','send']
  ]);
  const toneMap = new Map([['🟢','good'],['🟡','medium'],['🔴','hard'],['⚪','neutral']]);
  const tokens = [...tokenMap.keys(), ...toneMap.keys()].sort((a, b) => b.length - a.length);
  const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tokenPattern = new RegExp(tokens.map(escapeRegExp).join('|'), 'gu');
  const ignoredParents = new Set(['SCRIPT', 'STYLE', 'TEXTAREA']);

  function iconNode(name, label) {
    const span = document.createElement('span');
    span.className = `vsl-icon vsl-icon--${name}`;
    span.dataset.icon = name;
    span.setAttribute('aria-hidden', 'true');
    span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.atom}</svg>`;
    if (label) span.title = label;
    return span;
  }

  function statusNode(tone) {
    const span = document.createElement('span');
    span.className = 'vsl-status-dot';
    span.dataset.tone = tone;
    span.setAttribute('aria-hidden', 'true');
    return span;
  }

  function replaceTextNode(node) {
    if (!node.nodeValue || !tokens.some((token) => node.nodeValue.includes(token))) return;
    const parent = node.parentElement;
    if (!parent || ignoredParents.has(parent.tagName) || parent.closest('.vsl-icon')) return;
    if (parent.tagName === 'OPTION' || parent.tagName === 'TITLE') {
      node.nodeValue = node.nodeValue.replace(tokenPattern, '').replace(/^\s+/, '');
      return;
    }
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    node.nodeValue.replace(tokenPattern, (match, offset) => {
      if (offset > cursor) fragment.append(document.createTextNode(node.nodeValue.slice(cursor, offset)));
      fragment.append(toneMap.has(match) ? statusNode(toneMap.get(match)) : iconNode(tokenMap.get(match)));
      cursor = offset + match.length;
      return match;
    });
    if (cursor < node.nodeValue.length) fragment.append(document.createTextNode(node.nodeValue.slice(cursor)));
    node.replaceWith(fragment);
  }

  function sanitizeAttributes(root) {
    const elements = root.nodeType === Node.ELEMENT_NODE ? [root, ...root.querySelectorAll('[placeholder], [title], [aria-label]')] : [];
    elements.forEach((element) => {
      ['placeholder', 'title', 'aria-label'].forEach((attribute) => {
        if (!element.hasAttribute(attribute)) return;
        const original = element.getAttribute(attribute);
        const clean = original.replace(tokenPattern, '').replace(/\s{2,}/g, ' ').trim();
        if (clean !== original) element.setAttribute(attribute, clean);
      });
    });
  }

  function process(root) {
    if (!root || root.nodeType !== Node.ELEMENT_NODE) return;
    sanitizeAttributes(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    textNodes.forEach(replaceTextNode);
  }

  document.addEventListener('DOMContentLoaded', () => {
    process(document.body);
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'characterData') replaceTextNode(mutation.target);
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.TEXT_NODE) replaceTextNode(node);
          else process(node);
        });
        if (mutation.type === 'attributes') sanitizeAttributes(mutation.target);
      });
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['placeholder', 'title', 'aria-label'] });
  });
})();
