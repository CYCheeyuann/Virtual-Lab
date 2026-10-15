/* ─── Smart Flashcards — Storage + Leitner engine + UI controller ───── */

/* Pure gesture classifier shared by the touch handler and the regression test.
 * Returns one of: 'flip' | 'grade-hard' | 'grade-easy' | 'none'.
 * Keeping this pure (no DOM) lets flashcards.test.js assert the single-tap /
 * swipe / scroll outcomes without a browser. */
function classifyFlashcardGesture(dx, dy, dt, moved) {
  const absX = Math.abs(dx), absY = Math.abs(dy);
  const horizontalish = absX > absY * 1.5;
  const v = absX / Math.max(1, dt);
  const big = absX > 60 && v > 0.3;
  if (horizontalish && big) return dx < 0 ? 'grade-hard' : 'grade-easy';
  if (absY > 12 && absY >= absX) return 'none';       // vertical scroll
  if (absX < 10 && absY < 10 && !moved) return 'flip'; // tap
  return 'none';
}
/* Shared click-suppression decision used by BOTH the stage click handler and
 * the regression test, so the test exercises the real logic rather than a
 * copy. Given the current suppress flag, returns whether this click should
 * flip and what the flag becomes next. A touch tap arms suppression in
 * pointerup, so the synthetic click that follows is swallowed exactly once. */
function decideClickFlip(suppressNextClick) {
  if (suppressNextClick) return { flip: false, suppressNextClick: false };
  return { flip: true, suppressNextClick: false };
}
/* istanbul ignore next */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { classifyFlashcardGesture, decideClickFlip };
}

(function () {
  'use strict';

  // In a non-browser context (the Node regression test requires this file only
  // for the pure classifier above) there is no DOM — skip the UI controller.
  if (typeof window === 'undefined') return;

  // ══════════════════════════════════════════════════════════════════════
  // STORAGE
  // ══════════════════════════════════════════════════════════════════════
  const KEY = 'vsl.flashcards';
  const VERSION = 1;
  const QUOTA_BYTES = 3_000_000;
  let sourceFile = { data: null, mime: null, name: null, text: '' };

  const Store = (function () {
    function emptyStore() { return { version: VERSION, decks: [] }; }
    function load() {
      try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return emptyStore();
        const obj = JSON.parse(raw);
        if (!obj || obj.version !== VERSION || !Array.isArray(obj.decks)) {
          return emptyStore();
        }
        return obj;
      } catch (e) {
        return emptyStore();
      }
    }
    function save(store) {
      let json = JSON.stringify(store);
      // Quota guard: if we're approaching limits, drop oldest cards in the
      // largest deck until we fit.
      if (json.length > QUOTA_BYTES) {
        let trimmed = false;
        while (json.length > QUOTA_BYTES && store.decks.length) {
          const biggest = store.decks
            .slice()
            .sort((a, b) => b.cards.length - a.cards.length)[0];
          if (!biggest || !biggest.cards.length) break;
          const drop = Math.max(1, Math.floor(biggest.cards.length * 0.1));
          biggest.cards.splice(0, drop);
          trimmed = true;
          json = JSON.stringify(store);
        }
        if (trimmed && typeof window.showToast === 'function') {
          window.showToast('Older flashcards trimmed to free space', 'warning');
        }
      }
      try { localStorage.setItem(KEY, json); }
      catch (e) {
        if (typeof window.showToast === 'function') {
          window.showToast('Storage full — clear some flashcards to keep saving.', 'error');
        }
      }
    }
    return { load, save };
  })();

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }
  function todayLocal() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  // ══════════════════════════════════════════════════════════════════════
  // LEITNER ENGINE
  // ══════════════════════════════════════════════════════════════════════
  const LEITNER_DAYS = { 1: 1, 2: 3, 3: 7, 4: 14, 5: 30 };
  const MS_PER_DAY = 86400000;

  function applyGrade(card, grade) {
    const oldBox = card.box;
    if (grade === 'hard') card.box = 1;
    else if (grade === 'easy') card.box = Math.min(5, card.box + 1);
    // 'okay' leaves box unchanged
    card.lastReviewedAt = Date.now();
    card.nextReviewDate = card.lastReviewedAt + LEITNER_DAYS[card.box] * MS_PER_DAY;
    card.history = card.history || [];
    card.history.push({ ts: card.lastReviewedAt, grade, box: card.box });
    if (card.history.length > 50) card.history.splice(0, card.history.length - 50);
    return { from: oldBox, to: card.box };
  }

  function dueCount(deck) {
    const now = Date.now();
    return deck.cards.filter(c => c.nextReviewDate <= now).length;
  }

  function buildDueQueue(deck) {
    const now = Date.now();
    const due = deck.cards.filter(c => c.nextReviewDate <= now);
    const fresh = due.filter(c => !c.lastReviewedAt);
    const reviews = due.filter(c => c.lastReviewedAt);
    // Reset the daily-new counter at local-day rollover
    const today = todayLocal();
    if (deck.lastSessionDay !== today) {
      deck.newServedToday = 0;
      deck.lastSessionDay = today;
    }
    const remainingNew = Math.max(0, (deck.dailyNewCap || 20) - (deck.newServedToday || 0));
    const cappedFresh = fresh.slice(0, remainingNew);
    // Interleave: 1 new card after every 2 reviews
    const out = [];
    let r = 0, n = 0;
    while (r < reviews.length || n < cappedFresh.length) {
      if (r < reviews.length) out.push(reviews[r++]);
      if (r < reviews.length && r % 2 === 0 && n < cappedFresh.length) out.push(cappedFresh[n++]);
      else if (r >= reviews.length && n < cappedFresh.length) out.push(cappedFresh[n++]);
    }
    deck._sessionFreshCount = cappedFresh.length;
    return out;
  }

  // ══════════════════════════════════════════════════════════════════════
  // DECK FACTORIES
  // ══════════════════════════════════════════════════════════════════════
  function makeDeck({ subject, bab, topic }) {
    return {
      id: uid(),
      subject,
      bab: String(bab).trim(),
      topic: String(topic || '').trim(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      dailyNewCap: 20,
      lastSessionDay: todayLocal(),
      newServedToday: 0,
      cards: [],
    };
  }
  function makeCard({ front, back, hint, tags }) {
    const now = Date.now();
    return {
      id: uid(),
      front: String(front || '').trim(),
      back: String(back || '').trim(),
      hint: hint ? String(hint).trim() : null,
      tags: Array.isArray(tags) ? tags.map(String) : [],
      box: 1,
      lastReviewedAt: null,
      nextReviewDate: now,
      history: [],
    };
  }

  function persistNewDeck(deck, cardsRaw) {
    const cards = (cardsRaw || []).map(makeCard).filter(c => c.front && c.back);
    deck.cards = cards;
    const store = Store.load();
    store.decks.unshift(deck);
    Store.save(store);
    return deck.id;
  }

  // ══════════════════════════════════════════════════════════════════════
  // BACKEND CALL
  // ══════════════════════════════════════════════════════════════════════
  async function generateCards(payload) {
    const url = window.STREAM_URLS && window.STREAM_URLS.flashcard_generator;
    if (!url || url.startsWith('__URL_')) {
      throw new Error('Flashcards backend not yet deployed');
    }
    const headers = (typeof window.apiHeaders === 'function')
      ? window.apiHeaders()
      : { 'Content-Type': 'application/json' };
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    const json = await resp.json();
    if (json.error && !json.cards) throw new Error(json.error);
    return json.cards || [];
  }

  // ══════════════════════════════════════════════════════════════════════
  // PUBLIC API (used by chapter.html and quiz.html cross-module hooks)
  // ══════════════════════════════════════════════════════════════════════
  async function createDeckFromText({ subject, chapter, topic, source_text, num_cards }) {
    const cards = await generateCards({
      mode: source_text ? 'from_text' : 'from_topic',
      subject, chapter, topic,
      num_cards: num_cards || 12,
      source_text: source_text || '',
    });
    if (!cards.length) throw new Error('No cards generated');
    const deck = makeDeck({ subject, bab: chapter, topic });
    return persistNewDeck(deck, cards);
  }

  async function saveQuizMistakes({ subject, chapter, topic, wrong_answers }) {
    if (!Array.isArray(wrong_answers) || !wrong_answers.length) {
      throw new Error('No wrong answers to save');
    }
    const cards = await generateCards({
      mode: 'from_quiz',
      subject, chapter, topic,
      num_cards: wrong_answers.length,
      wrong_answers,
    });
    if (!cards.length) throw new Error('No cards generated');
    const deck = makeDeck({ subject, bab: chapter, topic });
    deck.topic = `${topic || chapter} · Mistakes`;
    return persistNewDeck(deck, cards);
  }

  // Expose immediately so chapter.html / quiz.html can call us before init
  window.Flashcards = {
    createDeckFromText,
    saveQuizMistakes,
    isBackendLive() {
      const u = window.STREAM_URLS && window.STREAM_URLS.flashcard_generator;
      return !!u && !u.startsWith('__URL_');
    },
  };

  // ══════════════════════════════════════════════════════════════════════
  // PAGE-SPECIFIC INIT (only runs on flashcards.html)
  // ══════════════════════════════════════════════════════════════════════
  function isFlashcardsPage() {
    return /flashcards\.html$/i.test(location.pathname) ||
           !!document.getElementById('flashcards-page');
  }

  const SUBJECT_ICON = { Biology: '🧬', Chemistry: '🧪', Physics: '⚛️', Science: '🔬' };

  function escHtml(s) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(s);
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  // Escape, then render **bold** as <strong>
  function richText(s) {
    return escHtml(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  }

  // ── Library view ──
  function renderLibrary() {
    const grid = document.getElementById('deckGrid');
    if (!grid) return;
    const store = Store.load();
    if (!store.decks.length) {
      grid.innerHTML = `<div class="empty-library">
        No decks yet. Create one above, or generate flashcards directly from
        the <a href="chapter.html">Chapter Assistant</a> or
        <a href="quiz.html">Quiz Generator</a>.
      </div>`;
      return;
    }
    grid.innerHTML = store.decks.map(deck => {
      const due = dueCount(deck);
      const total = deck.cards.length;
      const icon = SUBJECT_ICON[deck.subject] || '🔬';
      return `
        <div class="deck-card" data-subject="${escHtml(deck.subject)}" data-deck="${deck.id}">
          <div class="deck-head">
            <span class="deck-icon">${icon}</span>
            <div>
              <div class="deck-title">${escHtml(deck.subject)} · ${escHtml(deck.bab)}</div>
              ${deck.topic ? `<div class="deck-subtitle">${escHtml(deck.topic)}</div>` : ''}
            </div>
          </div>
          <div class="deck-stats">
            ${due > 0
              ? `<span class="deck-due">Due today: ${due}</span>`
              : `<span class="deck-due zero">✓ All caught up</span>`}
            <span class="deck-meta">${total} card${total === 1 ? '' : 's'}</span>
          </div>
          <div class="deck-actions">
            <button class="btn btn-primary btn-sm" data-act="study" ${total === 0 ? 'disabled' : ''}>Study Now</button>
            <button class="btn btn-ghost btn-sm" data-act="reset">Reset</button>
            <button class="btn btn-ghost btn-sm" data-act="delete" title="Delete deck"
              style="color:var(--c-error-fg)">Delete</button>
          </div>
        </div>`;
    }).join('');

    grid.querySelectorAll('.deck-card').forEach(el => {
      const id = el.dataset.deck;
      el.querySelector('[data-act="study"]')?.addEventListener('click', () => startStudy(id));
      el.querySelector('[data-act="reset"]')?.addEventListener('click', () => resetDeck(id));
      el.querySelector('[data-act="delete"]')?.addEventListener('click', () => deleteDeck(id));
    });
  }

  function resetDeck(id) {
    if (!confirm('Reset all cards in this deck back to Box 1?')) return;
    const store = Store.load();
    const d = store.decks.find(x => x.id === id);
    if (!d) return;
    const now = Date.now();
    d.cards.forEach(c => {
      c.box = 1;
      c.lastReviewedAt = null;
      c.nextReviewDate = now;
      c.history = [];
    });
    d.newServedToday = 0;
    d.updatedAt = now;
    Store.save(store);
    renderLibrary();
    if (typeof window.showToast === 'function') window.showToast('Deck progress reset', 'success');
  }
  function deleteDeck(id) {
    if (!confirm('Delete this entire deck?')) return;
    if (!confirm('Are you sure? This cannot be undone.')) return;
    const store = Store.load();
    const i = store.decks.findIndex(x => x.id === id);
    if (i < 0) return;
    store.decks.splice(i, 1);
    Store.save(store);
    renderLibrary();
    if (typeof window.showToast === 'function') window.showToast('Deck deleted', 'success');
  }

  // ── Generate-deck form ──
  async function onGenerateClick() {
    const btn = document.getElementById('generateDeckBtn');
    const subject = document.getElementById('subject').value;
    const babEl   = document.getElementById('newBab');
    const bab     = babEl.value.trim();
    const topic   = document.getElementById('newTopic').value.trim();
    const source  = document.getElementById('newSource').value.trim();
    const count   = parseInt(document.getElementById('newCount').value, 10) || 12;

    if (!bab) {
      babEl.classList.add('invalid');
      babEl.focus();
      if (typeof window.showToast === 'function') {
        window.showToast('Chapter Name / Bab is required', 'warning');
      }
      return;
    }
    babEl.classList.remove('invalid');

    if (!window.Flashcards.isBackendLive()) {
      if (typeof window.showToast === 'function') {
        window.showToast('Flashcards backend not yet deployed', 'error');
      }
      return;
    }

    if (typeof window.setButtonLoading === 'function') window.setButtonLoading(btn, true, 'Generating…');
    try {
      const combinedSource = [source, sourceFile.text].filter(Boolean).join('\n\n');
      const cards = await generateCards({
        mode: (source || sourceFile.data) ? 'from_text' : 'from_topic',
        subject, chapter: bab, topic,
        num_cards: count,
        source_text: combinedSource,
        file_data: sourceFile.data,
        file_mime: sourceFile.mime,
        file_name: sourceFile.name,
      });
      if (!cards.length) throw new Error('No cards generated');
      // Show preview step
      showPreview({ subject, bab, topic, cards });
    } catch (err) {
      if (typeof window.showToast === 'function') {
        window.showToast('Generation failed: ' + err.message, 'error');
      }
    } finally {
      if (typeof window.setButtonLoading === 'function') window.setButtonLoading(btn, false);
    }
  }

  // ── Preview step (show extracted cards before confirming) ──
  function showPreview({ subject, bab, topic, cards }) {
    const previewSection = document.getElementById('previewSection');
    const previewList = document.getElementById('previewList');
    const newDeckSection = document.getElementById('newDeck');
    if (!previewSection || !previewList) return;

    newDeckSection.style.display = 'none';
    previewSection.style.display = '';
    document.getElementById('previewTitle').textContent =
      `Preview: ${cards.length} cards for "${bab}"`;

    // v2: render each card as a collapsed <details> element so each row shows
    // only the question by default, with a chevron that rotates on toggle.
    // Native <details> gives us free keyboard support and accessibility.
    previewList.innerHTML = `
      <div class="preview-bar">
        <button class="preview-bulk" type="button" id="previewBulkToggle">Expand All</button>
      </div>
      ${cards.map((c, i) => `
        <details class="preview-card">
          <summary class="preview-card-summary">
            <span class="preview-num">${i + 1}</span>
            <span class="preview-q-text"><strong>Q:</strong> ${escHtml(c.front)}</span>
            <span class="preview-chevron" aria-hidden="true">▼</span>
          </summary>
          <div class="preview-card-body">
            <div class="preview-back"><strong>A:</strong> ${richText(c.back)}</div>
            ${c.hint ? `<div class="preview-hint">💡 ${escHtml(c.hint)}</div>` : ''}
          </div>
        </details>
      `).join('')}
    `;

    // Bulk toggle
    const bulkBtn = document.getElementById('previewBulkToggle');
    bulkBtn?.addEventListener('click', () => {
      const rows = previewList.querySelectorAll('details.preview-card');
      const openCount = [...rows].filter(d => d.open).length;
      // If most are closed, open all; otherwise close all.
      const target = openCount < rows.length / 2;
      rows.forEach(d => { d.open = target; });
      bulkBtn.textContent = target ? 'Collapse All' : 'Expand All';
    });
    // Keep the bulk button label in sync when individual rows toggle
    previewList.querySelectorAll('details.preview-card').forEach(d => {
      d.addEventListener('toggle', () => {
        const rows = previewList.querySelectorAll('details.preview-card');
        const openCount = [...rows].filter(x => x.open).length;
        if (openCount === rows.length) bulkBtn.textContent = 'Collapse All';
        else if (openCount === 0)       bulkBtn.textContent = 'Expand All';
      });
    });

    // Wire confirm / back buttons
    const confirmBtn = document.getElementById('confirmFlashBtn');
    const backBtn = document.getElementById('previewBackBtn');
    const cloneConfirm = confirmBtn.cloneNode(true);
    const cloneBack = backBtn.cloneNode(true);
    confirmBtn.replaceWith(cloneConfirm);
    backBtn.replaceWith(cloneBack);

    cloneBack.addEventListener('click', () => {
      previewSection.style.display = 'none';
      newDeckSection.style.display = '';
    });
    cloneConfirm.addEventListener('click', () => {
      const deck = makeDeck({ subject, bab, topic });
      const id = persistNewDeck(deck, cards);
      previewSection.style.display = 'none';
      newDeckSection.style.display = '';
      // Clear form
      document.getElementById('newBab').value = '';
      document.getElementById('newTopic').value = '';
      document.getElementById('newSource').value = '';
      document.getElementById('flashSourceFileInfo').textContent = '';
      document.getElementById('flashSourceFile').value = '';
      sourceFile = { data: null, mime: null, name: null, text: '' };
      renderLibrary();
      if (typeof window.showToast === 'function') {
        window.showToast('Deck confirmed & created', 'success');
      }
      startStudy(id);
    });

    window.scrollTo({ top: previewSection.offsetTop - 80, behavior: 'smooth' });
  }

  // ══════════════════════════════════════════════════════════════════════
  // STUDY MODE
  // ══════════════════════════════════════════════════════════════════════
  const ui = {
    overlayOpen: false,
    flipped: false,
    deckId: null,
    queue: [],
    idx: 0,
    breakdown: { hard: 0, okay: 0, easy: 0 },
    pointer: { down: false, moved: false, x0: 0, y0: 0, t0: 0 },
    suppressNextClick: false,
  };

  function startStudy(deckId) {
    const store = Store.load();
    const deck = store.decks.find(d => d.id === deckId);
    if (!deck) return;
    if (!deck.cards.length) {
      if (typeof window.showToast === 'function') window.showToast('Deck is empty', 'warning');
      return;
    }
    ui.deckId = deckId;
    ui.queue = buildDueQueue(deck);
    if (!ui.queue.length) {
      // Nothing due — let user study every card anyway as a "cram" pass
      ui.queue = deck.cards.slice();
      if (typeof window.showToast === 'function') {
        window.showToast('Nothing due — running a free practice pass', 'info');
      }
    }
    ui.idx = 0;
    ui.breakdown = { hard: 0, okay: 0, easy: 0 };
    ui.flipped = false;
    document.getElementById('fcOverlay').classList.add('open');
    ui.overlayOpen = true;
    document.body.style.overflow = 'hidden';
    showCurrentCard();
    // Focus the stage so Enter works without an extra click
    setTimeout(() => document.getElementById('fcStage')?.focus(), 50);
  }

  function showCurrentCard() {
    const stage = document.getElementById('fcStage');
    const summary = document.getElementById('fcSummary');
    const actions = document.getElementById('fcActions');
    const hintRow = document.getElementById('fcHintRow');
    const progress = document.getElementById('fcProgress');

    if (ui.idx >= ui.queue.length) {
      // Session done
      stage.style.display = 'none';
      actions.hidden = true;
      hintRow.hidden = true;
      summary.hidden = false;
      const reviewed = ui.queue.length;
      summary.innerHTML = `
        <h3>✅ Session complete</h3>
        <p>You reviewed <strong>${reviewed}</strong> card${reviewed === 1 ? '' : 's'}.</p>
        <div class="fc-summary-row">
          <div><strong>${ui.breakdown.easy}</strong>🟢 Easy</div>
          <div><strong>${ui.breakdown.okay}</strong>🟡 Okay</div>
          <div><strong>${ui.breakdown.hard}</strong>🔴 Hard</div>
        </div>
        <button class="btn btn-primary fc-exit-done" style="margin-top:14px">Back to Library</button>`;
      summary.querySelector('.fc-exit-done')?.addEventListener('click', exitStudy);
      progress.textContent = `${reviewed} / ${reviewed} done`;
      // Attach feedback widget at the bottom of the summary block.
      if (window.Feedback && !summary.querySelector('.fb-widget')) {
        const wrap = document.createElement('div');
        wrap.style.marginTop = '14px';
        summary.appendChild(wrap);
        const store = Store.load();
        const deck = store.decks.find(d => d.id === ui.deckId);
        window.Feedback.attach(wrap, {
          feature: 'flashcards',
          subject: deck ? deck.subject : null,
          context: deck ? `${deck.bab}`.slice(0, 80) : null,
        });
      }
      return;
    }

    summary.hidden = true;
    stage.style.display = '';
    const card = ui.queue[ui.idx];
    document.getElementById('fcPrompt').innerHTML = richText(card.front);
    document.getElementById('fcAnswer').innerHTML = richText(card.back);
    const hintBtn = document.getElementById('fcHintBtn');
    const hintEl  = document.getElementById('fcHint');
    if (card.hint) {
      hintRow.hidden = false;
      hintBtn.textContent = 'Reveal Hint';
      hintEl.hidden = true;
      hintEl.textContent = card.hint;
    } else {
      hintRow.hidden = true;
    }
    ui.flipped = false;
    stage.dataset.flipped = 'false';
    // v2: grading buttons are ALWAYS visible — no flip gate.
    // hint row visibility depends only on whether the card has a hint to reveal.
    progress.textContent = `${ui.idx + 1} / ${ui.queue.length} · Box ${card.box}/5`;
  }

  function flipCard() {
    if (!ui.overlayOpen) return;
    // Toggle the flip — allows infinite front/back flipping
    ui.flipped = !ui.flipped;
    document.getElementById('fcStage').dataset.flipped = String(ui.flipped);
    // Hint row hides while showing the back (the answer is already revealed)
    document.getElementById('fcHintRow').hidden = ui.flipped;
  }

  function grade(g) {
    // v2: grading is always allowed — no flip gate.
    if (!ui.overlayOpen) return;
    if (!['hard','okay','easy'].includes(g)) return;
    const card = ui.queue[ui.idx];
    if (!card) return;
    const store = Store.load();
    const deck = store.decks.find(d => d.id === ui.deckId);
    if (!deck) { exitStudy(); return; }
    const liveCard = deck.cards.find(c => c.id === card.id);
    if (!liveCard) { ui.idx++; showCurrentCard(); return; }
    applyGrade(liveCard, g);
    if (!card.lastReviewedAt) {
      // This was a fresh card — count it against today's new-card cap
      deck.newServedToday = (deck.newServedToday || 0) + 1;
    }
    deck.updatedAt = Date.now();
    Store.save(store);
    ui.breakdown[g]++;
    ui.idx++;
    showCurrentCard();
  }

  function exitStudy() {
    document.getElementById('fcOverlay').classList.remove('open');
    document.body.style.overflow = '';
    ui.overlayOpen = false;
    ui.flipped = false;
    renderLibrary();
  }

  // Keyboard — v2 rules:
  //   Enter (when stage focused) → flip
  //   Space, Tab, arrows → ignored for flip (browser scroll/focus is preserved)
  //   1 / 2 / 3 → grade anytime (no flip gate)
  //   Escape → exit
  function onKey(e) {
    if (!ui.overlayOpen) return;
    if (e.key === 'Escape') { e.preventDefault(); exitStudy(); return; }
    if (e.key === 'Enter') {
      // Only flip when the stage is the focused element (or focus is inside it)
      const stage = document.getElementById('fcStage');
      if (stage && (document.activeElement === stage || stage.contains(document.activeElement))) {
        e.preventDefault();
        flipCard();
      }
      return;
    }
    // Note: Spacebar intentionally has NO handler — it falls through to the
    // browser so the page scrolls normally if the user wants to.
    if (e.key === '1') { e.preventDefault(); grade('hard'); }
    else if (e.key === '2') { e.preventDefault(); grade('okay'); }
    else if (e.key === '3') { e.preventDefault(); grade('easy'); }
  }

  // Pointer events — on touch they own BOTH tap-to-flip and swipe-to-grade.
  // The synthesized click that follows a touch tap is suppressed (see
  // suppressNextClick) so a single tap never flips twice. Desktop mouse flips
  // through the click listener only.
  function onPointerDown(e) {
    if (!ui.overlayOpen) return;
    if (e.pointerType !== 'touch') return;   // desktop uses click handler instead
    ui.pointer.down = true;
    ui.pointer.moved = false;
    ui.pointer.x0 = e.clientX; ui.pointer.y0 = e.clientY; ui.pointer.t0 = Date.now();
  }
  function onPointerMove(e) {
    if (!ui.pointer.down || e.pointerType !== 'touch') return;
    if (Math.abs(e.clientX - ui.pointer.x0) > 10 ||
        Math.abs(e.clientY - ui.pointer.y0) > 10) {
      ui.pointer.moved = true;
    }
  }
  // A gesture that the browser turns into a scroll (or that leaves the card)
  // fires pointercancel — treat it as "no tap, no grade", and still swallow the
  // stray click so we don't flip after a scroll.
  function onPointerCancel(e) {
    if (e.pointerType !== 'touch') return;
    ui.pointer.down = false;
    ui.pointer.moved = false;
    ui.suppressNextClick = true;
    setTimeout(() => { ui.suppressNextClick = false; }, 400);
  }
  function onPointerUp(e) {
    if (!ui.pointer.down) return;
    ui.pointer.down = false;
    if (e.pointerType !== 'touch') return;
    // Any touch interaction on the stage must swallow the browser's synthetic
    // click so tap-flip (handled here) is not immediately undone by click.
    ui.suppressNextClick = true;
    setTimeout(() => { ui.suppressNextClick = false; }, 400);

    const dx = e.clientX - ui.pointer.x0;
    const dy = e.clientY - ui.pointer.y0;
    const dt = Math.max(1, Date.now() - ui.pointer.t0);

    // Single source of truth with the regression test. A swipe grades (and
    // never also flips); a vertical scroll does nothing; a tiny tap flips once.
    const outcome = classifyFlashcardGesture(dx, dy, dt, ui.pointer.moved);
    if (outcome === 'grade-hard')      grade('hard');
    else if (outcome === 'grade-easy') grade('easy');
    else if (outcome === 'flip')       flipCard();
  }

  // ══════════════════════════════════════════════════════════════════════
  // INIT
  // ══════════════════════════════════════════════════════════════════════
  function init() {
    if (!isFlashcardsPage()) return;

    // common.js's bindSubjectSelect already populates the <select id="subject">
    // and applies the theme, so we don't need to manually pre-fill it here.
    document.getElementById('generateDeckBtn')?.addEventListener('click', onGenerateClick);
    if (typeof window.setupDropzone === 'function') {
      window.setupDropzone('flashSourceDz', 'flashSourceFile', 'flashSourceFileInfo', file => {
        sourceFile = file;
      });
    }
    document.getElementById('newBab')?.addEventListener('input', (e) => {
      e.target.classList.remove('invalid');
    });

    // Wire study overlay events
    const stage = document.getElementById('fcStage');
    if (stage) {
      // Click flips for MOUSE only. A touch tap is handled in onPointerUp and
      // the following synthetic click is swallowed via suppressNextClick, so a
      // single tap flips exactly once.
      stage.addEventListener('click', (e) => {
        if (e.button !== 0) return;          // left-click only
        if (e.detail > 1) return;            // ignore double-click second event
        const d = decideClickFlip(ui.suppressNextClick);
        ui.suppressNextClick = d.suppressNextClick;
        if (d.flip) flipCard();
      });
      // Block the context menu (right-click) so it doesn't feel like an interaction
      stage.addEventListener('contextmenu', (e) => e.preventDefault());
      // Touch tap-flip + swipe-grade; desktop mouse uses the click handler above.
      stage.addEventListener('pointerdown', onPointerDown);
      stage.addEventListener('pointermove', onPointerMove, { passive: true });
      stage.addEventListener('pointerup', onPointerUp);
      stage.addEventListener('pointercancel', onPointerCancel);
    }
    document.getElementById('fcExitBtn')?.addEventListener('click', exitStudy);
    document.querySelectorAll('.fc-grade').forEach(b => {
      b.addEventListener('click', () => grade(b.dataset.grade));
    });
    document.getElementById('fcHintBtn')?.addEventListener('click', () => {
      const h = document.getElementById('fcHint');
      const hidden = h.hidden;
      h.hidden = !hidden;
      document.getElementById('fcHintBtn').textContent = hidden ? 'Hide Hint' : 'Reveal Hint';
    });
    document.addEventListener('keydown', onKey);

    renderLibrary();

    // Deep-link: ?deck=ID&autostudy=1
    try {
      const params = new URLSearchParams(location.search);
      if (params.get('autostudy') === '1') {
        const id = params.get('deck');
        if (id) setTimeout(() => startStudy(id), 250);
      }
    } catch (_) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
