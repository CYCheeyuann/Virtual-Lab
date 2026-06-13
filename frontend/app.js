/* ─── Streaming Lambda URLs (injected by GitHub Actions) ──────────────── */
const STREAM_URLS = {
  chapter_assistant: '__URL_CHAPTER_ASSISTANT__',
  experiment_guide:  '__URL_EXPERIMENT_GUIDE__',
  science_quiz:      '__URL_SCIENCE_QUIZ__',
  science_tutor:     '__URL_SCIENCE_TUTOR__',
};

/* ─── Global state ────────────────────────────────────────────────────── */
const state = {
  experimentFile: { data: null, mime: null, name: null },
  tutorFile:      { data: null, mime: null, name: null },
  chatHistory: [],   // [{role:'user'|'assistant', content:'...'}]
};

/* ─── DOM ready ───────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  setupDropzone('dz-experiment', 'file-experiment', 'file-info-experiment', 'experimentFile');
  setupDropzone('dz-tutor',      'file-tutor',      'file-info-tutor',      'tutorFile');

  document.querySelectorAll('[data-run]').forEach(btn => {
    btn.addEventListener('click', () => {
      const which = btn.dataset.run;
      if (which === 'chapter')    runChapter();
      if (which === 'experiment') runExperiment();
      if (which === 'quiz')       runQuiz();
    });
  });

  document.getElementById('runAllBtn').addEventListener('click', runAll);
  document.getElementById('resetBtn').addEventListener('click', resetAll);

  document.getElementById('chatSendBtn').addEventListener('click', sendChat);
  document.getElementById('chatInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') sendChat();
  });

  document.getElementById('revealAnswersBtn').addEventListener('click', () => {
    const out = document.getElementById('out-quiz');
    out.classList.toggle('answer-hidden');
  });
});

/* ─── File upload (drag and drop + click) ──────────────────────────────── */
function setupDropzone(zoneId, inputId, infoId, stateKey) {
  const zone  = document.getElementById(zoneId);
  const input = document.getElementById(inputId);
  const info  = document.getElementById(infoId);

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0], info, stateKey);
  });
  input.addEventListener('change', e => {
    if (e.target.files.length) handleFile(e.target.files[0], info, stateKey);
  });
}

function handleFile(file, info, stateKey) {
  const reader = new FileReader();
  reader.onload = () => {
    const result = reader.result;             // data:<mime>;base64,XXXX
    const commaIdx = result.indexOf(',');
    const base64   = result.slice(commaIdx + 1);
    state[stateKey] = { data: base64, mime: file.type, name: file.name };
    info.textContent = `📎 ${file.name} (${(file.size/1024).toFixed(1)} KB)`;
  };
  reader.readAsDataURL(file);
}

/* ─── Streaming fetch + markdown render ────────────────────────────────── */
async function streamToPanel(url, body, panelId) {
  const panel = document.getElementById(panelId);
  panel.innerHTML = '';

  // loading state
  const loading = document.createElement('div');
  loading.innerHTML = '<span class="spinner"></span>Thinking…';
  panel.appendChild(loading);

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    panel.innerHTML = '';
    const cursor = document.createElement('span');
    cursor.className = 'streaming-cursor';

    const reader  = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop();   // keep last (incomplete) line in buffer

      for (const line of lines) {
        appendMarkdownLine(panel, line, panelId);
      }

      // re-position cursor at the end
      if (cursor.parentNode) cursor.remove();
      panel.appendChild(cursor);
      panel.scrollTop = panel.scrollHeight;
    }

    // flush any leftover buffer
    if (buffer.length) appendMarkdownLine(panel, buffer, panelId);
    if (cursor.parentNode) cursor.remove();
  } catch (err) {
    panel.innerHTML = `<div class="error-msg">⚠️ ${err.message}</div>`;
  }
}

/* ─── Per-line markdown rendering ──────────────────────────────────────── */
function appendMarkdownLine(panel, raw, panelId) {
  const span = document.createElement('span');
  span.className = 'md-line';

  let line = raw.replace(/\r$/, '');
  let cls = '';

  if (/^---+\s*$/.test(line)) {
    span.classList.add('hr');
    panel.appendChild(span);
    return;
  }
  if (/^###\s+/.test(line))   { cls = 'h3'; line = line.replace(/^###\s+/, ''); }
  else if (/^##\s+/.test(line)) { cls = 'h2'; line = line.replace(/^##\s+/, ''); }
  else if (/^#\s+/.test(line))  { cls = 'h1'; line = line.replace(/^#\s+/, ''); }
  else if (/^\s*[-*]\s+/.test(line)) { cls = 'bullet'; line = line.replace(/^\s*[-*]\s+/, ''); }
  else if (/^\s*\d+\.\s+/.test(line)) { cls = 'numbered'; }

  if (cls) span.classList.add(cls);

  // mark answer lines for blur-toggle in quiz panel
  if (panelId === 'out-quiz') {
    if (/✅|Correct Answer/i.test(line))  span.classList.add('answer-line');
    if (/💡|Explanation/i.test(line))     span.classList.add('explanation-line');
  }

  // inline markdown: **bold**, *italic*, `code`
  const html = escapeHtml(line)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');

  span.innerHTML = html || '&nbsp;';
  panel.appendChild(span);
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
}

/* ─── Per-widget runners ───────────────────────────────────────────────── */
function runChapter() {
  const subject = document.getElementById('subject').value;
  return streamToPanel(STREAM_URLS.chapter_assistant, { subject }, 'out-chapter');
}

function runExperiment() {
  const subject    = document.getElementById('subject').value;
  const topic      = document.getElementById('experimentTopic').value.trim();
  const difficulty = document.getElementById('experimentDifficulty').value;

  if (!topic) {
    document.getElementById('out-experiment').innerHTML =
      '<div class="error-msg">⚠️ Please enter an experiment topic first.</div>';
    return;
  }

  const body = { subject, topic, difficulty };
  if (state.experimentFile.data) {
    body.file_data = state.experimentFile.data;
    body.file_mime = state.experimentFile.mime;
  }
  return streamToPanel(STREAM_URLS.experiment_guide, body, 'out-experiment');
}

function runQuiz() {
  const subject    = document.getElementById('subject').value;
  const quiz_topic = document.getElementById('quizTopic').value.trim();
  const difficulty = document.getElementById('quizDifficulty').value;

  if (!quiz_topic) {
    document.getElementById('out-quiz').innerHTML =
      '<div class="error-msg">⚠️ Please enter a quiz topic first.</div>';
    return;
  }
  return streamToPanel(STREAM_URLS.science_quiz,
    { subject, quiz_topic, difficulty }, 'out-quiz');
}

/* ─── Run all (parallel) ───────────────────────────────────────────────── */
function runAll() {
  const tasks = [runChapter()];
  if (document.getElementById('experimentTopic').value.trim()) tasks.push(runExperiment());
  if (document.getElementById('quizTopic').value.trim())       tasks.push(runQuiz());
  Promise.all(tasks);
}

/* ─── Reset ────────────────────────────────────────────────────────────── */
function resetAll() {
  ['out-chapter', 'out-experiment', 'out-quiz'].forEach(id => {
    document.getElementById(id).innerHTML =
      '<div class="placeholder">Output will appear here…</div>';
  });

  document.getElementById('experimentTopic').value = '';
  document.getElementById('quizTopic').value       = '';
  document.getElementById('experimentDifficulty').value = 'Standard';
  document.getElementById('quizDifficulty').value       = 'Standard';
  document.getElementById('subject').value              = 'Biology';

  document.getElementById('file-info-experiment').textContent = '';
  document.getElementById('file-info-tutor').textContent      = '';
  state.experimentFile = { data: null, mime: null, name: null };
  state.tutorFile      = { data: null, mime: null, name: null };

  state.chatHistory = [];
  document.getElementById('chat-panel').innerHTML =
    '<div class="chat-bubble bot">Conversation cleared. Ask me anything!</div>';
}

/* ─── Chat (Science Tutor) - streaming with history ───────────────────── */
async function sendChat() {
  const input = document.getElementById('chatInput');
  const message = input.value.trim();
  if (!message) return;

  const subject = document.getElementById('subject').value;
  const panel   = document.getElementById('chat-panel');

  // user bubble
  const userBubble = document.createElement('div');
  userBubble.className = 'chat-bubble user';
  userBubble.textContent = message;
  panel.appendChild(userBubble);

  input.value = '';
  panel.scrollTop = panel.scrollHeight;

  // bot bubble (streaming target)
  const botBubble = document.createElement('div');
  botBubble.className = 'chat-bubble bot';
  botBubble.innerHTML = '<span class="spinner"></span>';
  panel.appendChild(botBubble);

  const body = {
    subject,
    message,
    history: state.chatHistory.slice(),  // pass full prior history
  };
  if (state.tutorFile.data) {
    body.file_data = state.tutorFile.data;
    body.file_mime = state.tutorFile.mime;
    // attach the file only on first send so subsequent turns stay text
    state.tutorFile = { data: null, mime: null, name: null };
    document.getElementById('file-info-tutor').textContent = '';
  }

  try {
    const resp = await fetch(STREAM_URLS.science_tutor, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    botBubble.innerHTML = '';
    const cursor = document.createElement('span');
    cursor.className = 'streaming-cursor';
    botBubble.appendChild(cursor);

    const reader  = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let fullText = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      fullText += chunk;
      buffer += chunk;

      // live render
      cursor.remove();
      botBubble.innerHTML = renderInlineMarkdown(fullText) +
        '<span class="streaming-cursor"></span>';
      panel.scrollTop = panel.scrollHeight;
    }

    // final render without cursor
    botBubble.innerHTML = renderInlineMarkdown(fullText);

    // remember turn
    state.chatHistory.push({ role: 'user', content: message });
    state.chatHistory.push({ role: 'assistant', content: fullText });
  } catch (err) {
    botBubble.innerHTML = `<span class="error-msg">⚠️ ${err.message}</span>`;
  }
}

/* lightweight inline markdown for chat bubbles */
function renderInlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/^### (.+)$/gm, '<strong style="font-size:1.05em;color:#1b5e20">$1</strong>')
    .replace(/^## (.+)$/gm, '<strong style="font-size:1.1em;color:#1b5e20">$1</strong>')
    .replace(/^# (.+)$/gm,  '<strong style="font-size:1.15em;color:#1b5e20">$1</strong>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code style="background:#f1f8e9;padding:1px 5px;border-radius:4px">$1</code>')
    .replace(/\n/g, '<br>');
}
