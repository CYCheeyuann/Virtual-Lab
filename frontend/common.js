/* ─── Shared helpers used by every page ──────────────────────────────── */

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
}

/* Render one streaming line as a markdown <span class="md-line"> */
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
  if      (/^###\s+/.test(line))      { cls = 'h3'; line = line.replace(/^###\s+/, ''); }
  else if (/^##\s+/.test(line))       { cls = 'h2'; line = line.replace(/^##\s+/, ''); }
  else if (/^#\s+/.test(line))        { cls = 'h1'; line = line.replace(/^#\s+/, ''); }
  else if (/^\s*[-*]\s+/.test(line))  { cls = 'bullet';   line = line.replace(/^\s*[-*]\s+/, ''); }
  else if (/^\s*\d+\.\s+/.test(line)) { cls = 'numbered'; }

  if (cls) span.classList.add(cls);

  if (panelId === 'out-quiz') {
    if (/✅|Correct Answer/i.test(line)) span.classList.add('answer-line');
    if (/💡|Explanation/i.test(line))    span.classList.add('explanation-line');
  }

  const html = escapeHtml(line)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');

  span.innerHTML = html || '&nbsp;';
  panel.appendChild(span);
}

/* Stream POST a JSON body to a Lambda Function URL into a panel */
async function streamToPanel(url, body, panelId) {
  const panel = document.getElementById(panelId);
  panel.innerHTML = '<div><span class="spinner"></span>Thinking…</div>';

  if (!url || url.startsWith('__URL_')) {
    panel.innerHTML =
      '<div class="error-msg">⚠️ Streaming URL not configured. The CI pipeline injects these on deploy.</div>';
    return;
  }

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    panel.innerHTML = '';
    const cursor  = document.createElement('span');
    cursor.className = 'streaming-cursor';

    const reader  = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) appendMarkdownLine(panel, line, panelId);

      if (cursor.parentNode) cursor.remove();
      panel.appendChild(cursor);
      panel.scrollTop = panel.scrollHeight;
    }
    if (buffer) appendMarkdownLine(panel, buffer, panelId);
    if (cursor.parentNode) cursor.remove();
  } catch (err) {
    panel.innerHTML = `<div class="error-msg">⚠️ ${err.message}</div>`;
  }
}

/* Drag-and-drop / click upload, base64 stripping included */
function setupDropzone(zoneId, inputId, infoId, onLoad) {
  const zone  = document.getElementById(zoneId);
  const input = document.getElementById(inputId);
  const info  = document.getElementById(infoId);
  if (!zone || !input) return;

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });
  input.addEventListener('change', e => {
    if (e.target.files.length) handleFile(e.target.files[0]);
  });

  function handleFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      const comma  = result.indexOf(',');
      const base64 = result.slice(comma + 1);
      info.textContent = `📎 ${file.name} (${(file.size/1024).toFixed(1)} KB)`;
      onLoad({ data: base64, mime: file.type, name: file.name });
    };
    reader.readAsDataURL(file);
  }
}

/* Reset helpers exposed to all pages */
function clearPanel(id, msg = 'Output will appear here…') {
  const p = document.getElementById(id);
  if (p) p.innerHTML = `<div class="placeholder">${msg}</div>`;
}
