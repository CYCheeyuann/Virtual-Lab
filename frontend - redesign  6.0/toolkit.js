/* ─── Global Quick Reference Toolkit (FAB + Panel) ───────────────────────
 *  Self-contained vanilla JS. Injects a draggable FAB on the left edge
 *  that opens a glassmorphism panel with two tabs:
 *    Tab A: Smart Formula Sheet (search + accordion + KaTeX render)
 *    Tab B: Universal Unit Converter (bidirectional, 6 categories)
 *
 *  Dependencies: KaTeX (loaded from CDN on first formula tab open).
 *  No frameworks. localStorage for position/state memory.
 * ─────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  // ══════════════════════════════════════════════════════════════════════
  // FORMULA DATABASE
  // ══════════════════════════════════════════════════════════════════════
  const FORMULAS = {
    '🔬 General Science': [
      { name: 'Scientific Method Steps', latex: '\\text{Observe} \\to \\text{Hypothesize} \\to \\text{Experiment} \\to \\text{Analyze} \\to \\text{Conclude}', vars: 'The universal scientific process' },
      { name: 'Density', latex: '\\rho = \\frac{m}{V}', vars: 'ρ = density, m = mass, V = volume' },
      { name: 'Speed', latex: 'v = \\frac{d}{t}', vars: 'v = speed, d = distance, t = time' },
      { name: 'Efficiency', latex: '\\eta = \\frac{\\text{useful output}}{\\text{total input}} \\times 100\\%', vars: 'η = efficiency' },
      { name: 'Pressure', latex: 'P = \\frac{F}{A}', vars: 'P = pressure, F = force, A = area' },
      { name: 'Ideal Gas Law', latex: 'PV = nRT', vars: 'P = pressure, V = volume, n = moles, T = temp' },
      { name: 'Wave Speed', latex: 'v = f\\lambda', vars: 'v = speed, f = frequency, λ = wavelength' },
      { name: 'Energy Conservation', latex: 'E_{\\text{total}} = E_k + E_p = \\text{constant}', vars: 'Ek = kinetic, Ep = potential' },
    ],
    '🧬 Biology': [
      { name: 'Magnification', latex: 'M = \\frac{\\text{Image size}}{\\text{Actual size}}', vars: 'M = magnification factor' },
      { name: 'BMI', latex: '\\text{BMI} = \\frac{\\text{mass (kg)}}{\\text{height (m)}^2}', vars: 'Body Mass Index' },
      { name: 'Cardiac Output', latex: 'CO = HR \\times SV', vars: 'CO = cardiac output, HR = heart rate, SV = stroke volume' },
      { name: 'Hardy-Weinberg', latex: 'p^2 + 2pq + q^2 = 1', vars: 'p = dominant freq, q = recessive freq' },
      { name: 'Population Growth', latex: 'N_t = N_0 e^{rt}', vars: 'N = population, r = growth rate, t = time' },
      { name: 'Simpson Diversity Index', latex: 'D = 1 - \\sum \\left(\\frac{n}{N}\\right)^2', vars: 'n = individuals per species, N = total' },
      { name: '── Essential Math for Biology ──', latex: '', vars: '' },
      { name: 'Percentage Change', latex: '\\%\\Delta = \\frac{\\text{new} - \\text{old}}{\\text{old}} \\times 100', vars: 'Useful for growth rates, osmosis data' },
      { name: 'Mean (Average)', latex: '\\bar{x} = \\frac{\\sum x_i}{n}', vars: 'x̄ = mean, n = sample size' },
      { name: 'Standard Deviation', latex: 's = \\sqrt{\\frac{\\sum(x_i - \\bar{x})^2}{n-1}}', vars: 's = std dev, x̄ = mean' },
      { name: 'Chi-Squared Test', latex: '\\chi^2 = \\sum \\frac{(O-E)^2}{E}', vars: 'O = observed, E = expected' },
      { name: 'Probability (Punnett)', latex: 'P(A) = \\frac{\\text{favourable outcomes}}{\\text{total outcomes}}', vars: 'Basic genetic probability' },
      { name: 'Permutation', latex: 'P(n,r) = \\frac{n!}{(n-r)!}', vars: 'n = total, r = selected' },
      { name: 'Combination', latex: 'C(n,r) = \\frac{n!}{r!(n-r)!}', vars: 'n = total, r = selected' },
    ],
    '⚛️ Physics': [
      { name: "Newton's Second Law", latex: 'F = ma', vars: 'F = force, m = mass, a = acceleration' },
      { name: 'Kinetic Energy', latex: 'E_k = \\frac{1}{2}mv^2', vars: 'm = mass, v = velocity' },
      { name: 'Potential Energy', latex: 'E_p = mgh', vars: 'm = mass, g = gravity, h = height' },
      { name: 'Work', latex: 'W = Fd\\cos\\theta', vars: 'F = force, d = displacement, θ = angle' },
      { name: 'Power', latex: 'P = \\frac{W}{t}', vars: 'W = work, t = time' },
      { name: 'Kinematics', latex: 's = v_0 t + \\frac{1}{2}at^2', vars: 'v₀ = init velocity, a = accel, t = time' },
      { name: 'Universal Gravitation', latex: 'F = G\\frac{m_1 m_2}{r^2}', vars: 'G = constant, m = mass, r = distance' },
      { name: "Coulomb's Law", latex: 'F = k\\frac{q_1 q_2}{r^2}', vars: 'k = constant, q = charge, r = distance' },
      { name: "Ohm's Law", latex: 'V = IR', vars: 'V = voltage, I = current, R = resistance' },
      { name: 'Wave Speed', latex: 'v = f\\lambda', vars: 'v = speed, f = frequency, λ = wavelength' },
      { name: 'Mass-Energy', latex: 'E = mc^2', vars: 'E = energy, m = mass, c = speed of light' },
      { name: "Hooke's Law", latex: 'F = -kx', vars: 'k = spring constant, x = displacement' },
      { name: '── Essential Math for Physics ──', latex: '', vars: '' },
      { name: 'Pythagorean Theorem', latex: 'a^2 + b^2 = c^2', vars: 'a, b = legs, c = hypotenuse (vectors)' },
      { name: 'Trigonometry (SOH CAH TOA)', latex: '\\sin\\theta = \\frac{O}{H},\\; \\cos\\theta = \\frac{A}{H},\\; \\tan\\theta = \\frac{O}{A}', vars: 'O = opposite, A = adjacent, H = hypotenuse' },
      { name: 'Law of Cosines', latex: 'c^2 = a^2 + b^2 - 2ab\\cos C', vars: 'Used for non-right-angle vector addition' },
      { name: 'Quadratic Formula', latex: 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}', vars: 'Solving kinematics / projectile equations' },
      { name: 'Area of Circle', latex: 'A = \\pi r^2', vars: 'r = radius (circular motion, orbits)' },
      { name: 'Circumference', latex: 'C = 2\\pi r', vars: 'r = radius (circular path length)' },
      { name: 'Volume of Sphere', latex: 'V = \\frac{4}{3}\\pi r^3', vars: 'r = radius (gravitational fields)' },
      { name: 'Arithmetic Series', latex: 'S_n = \\frac{n(a_1 + a_n)}{2}', vars: 'Summing equal intervals in experiments' },
      { name: 'Geometric Series', latex: 'S_n = a_1 \\cdot \\frac{1-r^n}{1-r}', vars: 'Decay / half-life series' },
    ],
    '🧪 Chemistry': [
      { name: 'Moles', latex: 'n = \\frac{m}{M}', vars: 'n = moles, m = mass, M = molar mass' },
      { name: 'Molarity', latex: 'c = \\frac{n}{V}', vars: 'c = concentration, n = moles, V = volume' },
      { name: 'Dilution', latex: 'c_1 V_1 = c_2 V_2', vars: 'c = concentration, V = volume' },
      { name: 'pH', latex: '\\text{pH} = -\\log[H^+]', vars: '[H⁺] = hydrogen ion conc.' },
      { name: 'pOH', latex: '\\text{pOH} = -\\log[OH^-]', vars: '[OH⁻] = hydroxide ion conc.' },
      { name: 'Rate of Reaction', latex: 'r = \\frac{\\Delta[A]}{\\Delta t}', vars: '[A] = concentration, t = time' },
      { name: 'Equilibrium Constant', latex: 'K_{eq} = \\frac{[C]^c[D]^d}{[A]^a[B]^b}', vars: 'products / reactants' },
      { name: 'Gibbs Free Energy', latex: '\\Delta G = \\Delta H - T\\Delta S', vars: 'ΔH = enthalpy, T = temp, ΔS = entropy' },
      { name: 'Nernst Equation', latex: 'E = E^\\circ - \\frac{RT}{nF}\\ln Q', vars: 'E° = std potential, F = Faraday' },
      { name: '── Essential Math for Chemistry ──', latex: '', vars: '' },
      { name: 'Logarithm Base Change', latex: '\\log_a b = \\frac{\\ln b}{\\ln a}', vars: 'Used in pH / pKa calculations' },
      { name: 'Natural Logarithm', latex: '\\ln(ab) = \\ln a + \\ln b', vars: 'Simplifying rate law expressions' },
      { name: 'Scientific Notation', latex: 'a \\times 10^n,\\; 1 \\leq a < 10', vars: 'Expressing very large/small quantities' },
      { name: "Heron's Formula", latex: 'A = \\sqrt{s(s-a)(s-b)(s-c)}', vars: 's = semi-perimeter (titration curves)' },
    ],
  };

  // ══════════════════════════════════════════════════════════════════════
  // UNIT CONVERTER DATA
  // ══════════════════════════════════════════════════════════════════════
  const UNITS = {
    '🌡️ Temperature': { units: ['°C','°F','K'], special: true },
    '📏 Length': { units: ['mm','cm','m','km','in','ft','yd','mi'], base: 'm',
      factors: { mm:0.001, cm:0.01, m:1, km:1000, in:0.0254, ft:0.3048, yd:0.9144, mi:1609.344 }},
    '⚖️ Mass': { units: ['mg','g','kg','lb','oz','ton'], base: 'kg',
      factors: { mg:0.000001, g:0.001, kg:1, lb:0.453592, oz:0.0283495, ton:1000 }},
    '📦 Volume': { units: ['mL','L','m³','gal','qt','cup'], base: 'L',
      factors: { mL:0.001, L:1, 'm³':1000, gal:3.78541, qt:0.946353, cup:0.236588 }},
    '🔥 Energy': { units: ['J','kJ','cal','kcal','eV','kWh'], base: 'J',
      factors: { J:1, kJ:1000, cal:4.184, kcal:4184, eV:1.602e-19, kWh:3.6e6 }},
    '💨 Pressure': { units: ['Pa','kPa','atm','bar','mmHg','psi'], base: 'Pa',
      factors: { Pa:1, kPa:1000, atm:101325, bar:100000, mmHg:133.322, psi:6894.76 }},
  };

  function convertTemp(val, from, to) {
    let c;
    if (from === '°C') c = val;
    else if (from === '°F') c = (val - 32) * 5/9;
    else c = val - 273.15;
    if (to === '°C') return c;
    if (to === '°F') return c * 9/5 + 32;
    return c + 273.15;
  }

  function convertUnit(val, from, to, category) {
    const cat = UNITS[category];
    if (!cat) return NaN;
    if (cat.special) return convertTemp(val, from, to);
    const baseVal = val * cat.factors[from];
    return baseVal / cat.factors[to];
  }

  function formatNum(n) {
    if (n === 0) return '0';
    const abs = Math.abs(n);
    if (abs >= 1e9 || (abs < 1e-4 && abs > 0)) return n.toExponential(4);
    return parseFloat(n.toPrecision(6)).toString();
  }

  // ══════════════════════════════════════════════════════════════════════
  // KaTeX loader (lazy — only fetches when formula tab first opens)
  // ══════════════════════════════════════════════════════════════════════
  let katexReady = false;
  function loadKaTeX(cb) {
    if (katexReady) { cb(); return; }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css';
    document.head.appendChild(link);
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js';
    script.onload = () => { katexReady = true; cb(); };
    document.head.appendChild(script);
  }

  function renderKaTeX(latex, el) {
    if (window.katex) {
      try { window.katex.render(latex, el, { throwOnError: false, displayMode: true }); }
      catch (e) { el.textContent = latex; }
    } else { el.textContent = latex; }
  }

  // ══════════════════════════════════════════════════════════════════════
  // DOM BUILD + LOGIC
  // ══════════════════════════════════════════════════════════════════════
  let panelOpen = false;
  let activeTab = localStorage.getItem('tk.lastTab') || 'formulas';
  let activeConvCat = localStorage.getItem('tk.lastConvCat') || '🌡️ Temperature';
  let idleTimer = null;

  function build() {
    // FAB
    const fab = document.createElement('button');
    fab.className = 'tk-fab';
    fab.id = 'tk-fab';
    fab.setAttribute('aria-label', 'Open Quick Toolkit');
    fab.innerHTML = '<span class="tk-fab-icon">🧮</span>';
    fab.addEventListener('click', toggle);
    document.body.appendChild(fab);

    // Backdrop
    const bd = document.createElement('div');
    bd.className = 'tk-backdrop';
    bd.id = 'tk-backdrop';
    bd.addEventListener('click', close);
    document.body.appendChild(bd);

    // Panel
    const panel = document.createElement('div');
    panel.className = 'tk-panel';
    panel.id = 'tk-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Quick Toolkit');
    panel.innerHTML = `
      <div class="tk-header">
        <div class="tk-title">🧮 Quick Toolkit</div>
        <button class="tk-close" id="tk-close" aria-label="Close">✕</button>
      </div>
      <div class="tk-tabs">
        <button class="tk-tab ${activeTab==='formulas'?'active':''}" data-tab="formulas">∑ Formulas</button>
        <button class="tk-tab ${activeTab==='converter'?'active':''}" data-tab="converter">⚖️ Converter</button>
        <div class="tk-tab-indicator" id="tk-indicator"></div>
      </div>
      <div class="tk-body" id="tk-body"></div>`;
    document.body.appendChild(panel);

    document.getElementById('tk-close').addEventListener('click', close);
    panel.querySelectorAll('.tk-tab').forEach(t => {
      t.addEventListener('click', () => switchTab(t.dataset.tab));
    });
    updateIndicator();
    resetIdle();
    fab.addEventListener('mouseenter', () => { clearIdle(); fab.classList.remove('idle'); });
    fab.addEventListener('mouseleave', resetIdle);

    // Alt+T shortcut
    document.addEventListener('keydown', e => {
      if (e.altKey && e.key.toLowerCase() === 't') { e.preventDefault(); toggle(); }
      if (e.key === 'Escape' && panelOpen) close();
    });
  }

  function toggle() {
    panelOpen ? close() : open();
  }
  function open(tab) {
    panelOpen = true;
    document.getElementById('tk-panel').classList.add('open');
    document.getElementById('tk-backdrop').classList.add('show');
    document.getElementById('tk-fab').classList.add('panel-open');
    document.getElementById('tk-fab').innerHTML = '<span class="tk-fab-icon">✕</span>';
    if (tab) switchTab(tab); else renderTab();
  }
  function close() {
    panelOpen = false;
    document.getElementById('tk-panel').classList.remove('open');
    document.getElementById('tk-backdrop').classList.remove('show');
    document.getElementById('tk-fab').classList.remove('panel-open');
    document.getElementById('tk-fab').innerHTML = '<span class="tk-fab-icon">🧮</span>';
  }

  function switchTab(tab) {
    activeTab = tab;
    localStorage.setItem('tk.lastTab', tab);
    document.querySelectorAll('.tk-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    updateIndicator();
    renderTab();
  }
  function updateIndicator() {
    const tabs = document.querySelectorAll('.tk-tab');
    const ind = document.getElementById('tk-indicator');
    if (!ind) return;
    tabs.forEach(t => {
      if (t.classList.contains('active')) {
        ind.style.left = t.offsetLeft + 'px';
        ind.style.width = t.offsetWidth + 'px';
      }
    });
  }

  function resetIdle() { clearIdle(); idleTimer = setTimeout(() => { document.getElementById('tk-fab')?.classList.add('idle'); }, 8000); }
  function clearIdle() { if (idleTimer) clearTimeout(idleTimer); }

  // ── Tab rendering ──
  function renderTab() {
    const body = document.getElementById('tk-body');
    if (activeTab === 'formulas') { loadKaTeX(() => renderFormulas(body)); }
    else { renderConverter(body); }
  }

  // ══════════════════════════════════════════════════════════════════════
  // FORMULA TAB
  // ══════════════════════════════════════════════════════════════════════
  function renderFormulas(body) {
    body.innerHTML = `
      <div class="tk-search-wrap" id="tk-search-wrap">
        <input class="tk-search" id="tk-search" type="text" placeholder="🔍 Search science formulas (e.g. Photosynthesis, Velocity, pH)…" />
        <button class="tk-search-clear" id="tk-search-clear">✕</button>
      </div>
      <div id="tk-formula-list"></div>`;
    const input = document.getElementById('tk-search');
    const clear = document.getElementById('tk-search-clear');
    const wrap  = document.getElementById('tk-search-wrap');
    input.addEventListener('input', debounce(() => {
      wrap.classList.toggle('has-value', !!input.value);
      filterFormulas(input.value.trim().toLowerCase());
    }, 200));
    clear.addEventListener('click', () => { input.value = ''; wrap.classList.remove('has-value'); filterFormulas(''); });
    filterFormulas('');
  }

  function filterFormulas(query) {
    const host = document.getElementById('tk-formula-list');
    if (!host) return;
    host.innerHTML = '';
    let anyMatch = false;
    for (const [cat, items] of Object.entries(FORMULAS)) {
      const matches = query
        ? items.filter(f => (f.name + ' ' + f.latex + ' ' + f.vars).toLowerCase().includes(query))
        : items;
      if (!matches.length) continue;
      anyMatch = true;
      const open = !!query || cat === Object.keys(FORMULAS)[0];
      host.innerHTML += `
        <button class="tk-accordion-header ${open?'open':''}" data-cat="${cat}">
          <span class="tk-arrow">▶</span> ${cat}
          <span class="tk-badge">${matches.length}</span>
        </button>
        <div class="tk-accordion-body ${open?'open':''}" data-cat="${cat}">
          ${matches.map(f => formulaCardHTML(f)).join('')}
        </div>`;
    }
    if (!anyMatch) host.innerHTML = '<p style="color:var(--c-muted);text-align:center;padding:20px">😅 No formulas found</p>';

    // Accordion toggle
    host.querySelectorAll('.tk-accordion-header').forEach(h => {
      h.addEventListener('click', () => {
        h.classList.toggle('open');
        const b = host.querySelector(`.tk-accordion-body[data-cat="${h.dataset.cat}"]`);
        if (b) b.classList.toggle('open');
      });
    });
    // KaTeX render
    host.querySelectorAll('.tk-f-math').forEach(el => renderKaTeX(el.dataset.latex, el));
    // Copy buttons
    host.querySelectorAll('.tk-f-copy').forEach(btn => {
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(btn.dataset.latex).then(() => {
          btn.textContent = '✅'; setTimeout(() => btn.textContent = '📋', 1500);
        });
      });
    });
  }

  function formulaCardHTML(f) {
    // Use the central escapeHtml when available; fall back to a complete
    // local copy. The previous local `esc` was missing the `&` escape and
    // single-quote escape, so values like "Tom & Jerry" or anything inside
    // single-quoted attributes weren't safely encoded.
    const esc = (typeof window.escapeHtml === 'function')
      ? window.escapeHtml
      : (s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
          .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'));
    return `<div class="tk-formula-card">
      <button class="tk-f-copy" data-latex="${esc(f.latex)}" title="Copy LaTeX">📋</button>
      <div class="tk-f-name" aria-label="${esc(f.name)}">${esc(f.name)}</div>
      <div class="tk-f-math" data-latex="${esc(f.latex)}"></div>
      <div class="tk-f-vars">${esc(f.vars)}</div>
    </div>`;
  }

  // ══════════════════════════════════════════════════════════════════════
  // CONVERTER TAB
  // ══════════════════════════════════════════════════════════════════════
  function renderConverter(body) {
    const cats = Object.keys(UNITS);
    body.innerHTML = `
      <div class="tk-conv-categories" id="tk-conv-cats">
        ${cats.map(c => `<button class="tk-conv-cat ${c===activeConvCat?'active':''}" data-cat="${c}">${c}</button>`).join('')}
      </div>
      <div id="tk-conv-area"></div>`;
    body.querySelectorAll('.tk-conv-cat').forEach(btn => {
      btn.addEventListener('click', () => {
        activeConvCat = btn.dataset.cat;
        localStorage.setItem('tk.lastConvCat', activeConvCat);
        body.querySelectorAll('.tk-conv-cat').forEach(b => b.classList.toggle('active', b === btn));
        renderConvArea();
      });
    });
    renderConvArea();
  }

  function renderConvArea() {
    const area = document.getElementById('tk-conv-area');
    if (!area) return;
    const cat = UNITS[activeConvCat];
    const units = cat.units;
    area.innerHTML = `
      <div class="tk-conv-row">
        <input class="tk-conv-input" id="tk-from-val" type="text" placeholder="0" inputmode="decimal" />
        <select class="tk-conv-select" id="tk-from-unit">${units.map((u,i) => `<option ${i===0?'selected':''}>${u}</option>`).join('')}</select>
      </div>
      <div style="text-align:center;margin:6px 0">
        <button class="tk-conv-swap" id="tk-swap" title="Swap">⇅</button>
      </div>
      <div class="tk-conv-row">
        <input class="tk-conv-input" id="tk-to-val" type="text" placeholder="0" inputmode="decimal" />
        <select class="tk-conv-select" id="tk-to-unit">${units.map((u,i) => `<option ${i===1?'selected':''}>${u}</option>`).join('')}</select>
      </div>
      <div class="tk-conv-formula" id="tk-conv-formula"></div>`;

    const fromVal = document.getElementById('tk-from-val');
    const toVal   = document.getElementById('tk-to-val');
    const fromU   = document.getElementById('tk-from-unit');
    const toU     = document.getElementById('tk-to-unit');
    const formula = document.getElementById('tk-conv-formula');

    function calcForward() {
      const v = parseFloat(fromVal.value);
      fromVal.classList.toggle('invalid', fromVal.value && isNaN(v));
      if (isNaN(v)) { toVal.value = ''; formula.textContent = ''; return; }
      const result = convertUnit(v, fromU.value, toU.value, activeConvCat);
      toVal.value = formatNum(result);
      formula.textContent = `${fromVal.value} ${fromU.value} = ${toVal.value} ${toU.value}`;
    }
    function calcReverse() {
      const v = parseFloat(toVal.value);
      toVal.classList.toggle('invalid', toVal.value && isNaN(v));
      if (isNaN(v)) { fromVal.value = ''; formula.textContent = ''; return; }
      const result = convertUnit(v, toU.value, fromU.value, activeConvCat);
      fromVal.value = formatNum(result);
      formula.textContent = `${toVal.value} ${toU.value} = ${fromVal.value} ${fromU.value}`;
    }

    fromVal.addEventListener('input', debounce(calcForward, 100));
    toVal.addEventListener('input', debounce(calcReverse, 100));
    fromU.addEventListener('change', calcForward);
    toU.addEventListener('change', calcForward);
    document.getElementById('tk-swap').addEventListener('click', () => {
      const tmpU = fromU.value; fromU.value = toU.value; toU.value = tmpU;
      calcForward();
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // UTILS
  // ══════════════════════════════════════════════════════════════════════
  function debounce(fn, ms) {
    let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  // ══════════════════════════════════════════════════════════════════════
  // INIT
  // ══════════════════════════════════════════════════════════════════════
  function init() {
    if (document.getElementById('tk-fab')) return;
    build();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.Toolkit = { open, close, toggle };
})();
