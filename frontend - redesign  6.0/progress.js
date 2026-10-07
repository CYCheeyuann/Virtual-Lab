/* ─── Learning Progress Tracker ──────────────────────────────────────
 *  Tracks usage in localStorage. Surfaces a dashboard on the homepage.
 *  Keys:
 *    vsl.progress = {
 *      totalQuizzes:    number,
 *      totalQuestions:  number,
 *      totalCorrect:    number,
 *      lastSubject:     string,
 *      lastActiveDate:  'YYYY-MM-DD',
 *      streak:          number
 *    }
 *  ─────────────────────────────────────────────────────────────── */

const PROGRESS_KEY = 'vsl.progress';

function _todayStr() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
function _yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function loadProgress() {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return _emptyProgress();
    const obj = JSON.parse(raw);
    return Object.assign(_emptyProgress(), obj);
  } catch (e) {
    return _emptyProgress();
  }
}

function _emptyProgress() {
  return {
    totalQuizzes: 0,
    totalQuestions: 0,
    totalCorrect: 0,
    lastSubject: null,
    lastActiveDate: null,
    streak: 0,
  };
}

function saveProgress(p) {
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(p)); } catch (e) {}
}

/* Update streak based on today's activity */
function _bumpStreak(p) {
  const today = _todayStr();
  if (p.lastActiveDate === today) return;
  if (p.lastActiveDate === _yesterdayStr()) {
    p.streak = (p.streak || 0) + 1;
  } else {
    p.streak = 1;
  }
  p.lastActiveDate = today;
}

/* Record completed quiz (called from quiz.html after summary) */
function recordQuizResult({ subject, total, correct }) {
  const p = loadProgress();
  p.totalQuizzes   = (p.totalQuizzes   || 0) + 1;
  p.totalQuestions = (p.totalQuestions || 0) + (total || 0);
  p.totalCorrect   = (p.totalCorrect   || 0) + (correct || 0);
  if (subject) p.lastSubject = subject;
  _bumpStreak(p);
  saveProgress(p);
}

/* Record any activity (used by other pages) */
function recordActivity(subject) {
  const p = loadProgress();
  if (subject) p.lastSubject = subject;
  _bumpStreak(p);
  saveProgress(p);
}

/* Render the dashboard into a target element id */
function renderProgressDashboard(targetId) {
  const target = document.getElementById(targetId);
  if (!target) return;
  const p = loadProgress();

  // Coerce numeric fields to actual numbers so a tampered localStorage entry
  // cannot smuggle a string like '<img src=x onerror=...>' into a place that
  // will be rendered with innerHTML. NaN safely falls through to 0.
  const totalQuestions = Number(p.totalQuestions) || 0;
  const totalCorrect   = Number(p.totalCorrect)   || 0;
  const totalQuizzes   = Number(p.totalQuizzes)   || 0;
  const streak         = Number(p.streak)         || 0;
  const accuracy = totalQuestions > 0
    ? Math.round((totalCorrect / totalQuestions) * 100)
    : 0;

  // lastSubject is the only string field — escape it before insertion.
  // common.js's escapeHtml is loaded later on some pages, so fall back to a
  // local copy if it isn't on window yet.
  const _esc = (typeof window.escapeHtml === 'function')
    ? window.escapeHtml
    : (s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'));
  const lastSubject = _esc(p.lastSubject || '—');

  target.innerHTML = `
    <h2>📊 Your Learning Dashboard</h2>
    <div class="progress-stats">
      <div class="progress-stat">
        <div class="stat-emoji streak-flame">🔥</div>
        <div class="stat-meta">
          <span class="stat-value">${streak}-Day Streak</span>
          <span class="stat-label">Keep it going</span>
        </div>
      </div>
      <div class="progress-stat">
        <div class="stat-emoji">📝</div>
        <div class="stat-meta">
          <span class="stat-value">${totalQuizzes} Quiz${totalQuizzes === 1 ? '' : 'zes'}</span>
          <span class="stat-label">Completed</span>
        </div>
      </div>
      <div class="progress-stat">
        <div class="accuracy-pie" style="--pct:${accuracy}"></div>
        <div class="stat-meta">
          <span class="stat-value">${accuracy}% Accuracy</span>
          <span class="stat-label">${totalCorrect}/${totalQuestions} correct</span>
        </div>
      </div>
      <div class="progress-stat">
        <div class="stat-emoji">🎯</div>
        <div class="stat-meta">
          <span class="stat-value">${lastSubject}</span>
          <span class="stat-label">Last subject</span>
        </div>
      </div>
    </div>
  `;
}

/* expose globals */
window.loadProgress         = loadProgress;
window.saveProgress         = saveProgress;
window.recordQuizResult     = recordQuizResult;
window.recordActivity       = recordActivity;
window.renderProgressDashboard = renderProgressDashboard;
