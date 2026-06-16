/* ─── Subject-themed Vortex background ────────────────────────────────
 * Vanilla-JS port of the React Vortex component (simplex-noise particle
 * flow). Auto-injects a fixed canvas behind page content and re-tunes
 * its hue to match the active subject (data-subject on <html>).
 *
 * Layering:
 *   body gradient (CSS)  →  #vortex-canvas (z-index: -1)
 *                       →  .floating-icon (z-index: 0)
 *                       →  .page content    (z-index: 1)
 *                       →  navbar / chat fab (z-index: 100+)
 *
 * Performance: pauses on tab hide, halves particle count on mobile,
 * skips entirely if user prefers reduced motion.
 * ─────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  // Respect accessibility preference — no animation if user opts out.
  if (window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return;
  }

  /* ── Subject → hue mapping (HSL hue 0–360) ───────────────────────── */
  const SUBJECT_HUES = {
    Biology:   { baseHue: 110, rangeHue: 50 },   // green ↔ teal
    Chemistry: { baseHue: 260, rangeHue: 60 },   // violet ↔ magenta
    Physics:   { baseHue: 200, rangeHue: 50 },   // sky ↔ deep blue
  };

  /* ── 3D simplex noise (Stefan Gustavson reference, condensed) ───── */
  function makeNoise3D() {
    const perm = new Uint8Array(512);
    const p    = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    let s = (Date.now() ^ 0x9e3779b9) >>> 0;
    const rng = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 255; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0;
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

    const grad3 = new Float32Array([
       1, 1, 0,  -1, 1, 0,   1,-1, 0,  -1,-1, 0,
       1, 0, 1,  -1, 0, 1,   1, 0,-1,  -1, 0,-1,
       0, 1, 1,   0,-1, 1,   0, 1,-1,   0,-1,-1,
    ]);

    const F3 = 1 / 3, G3 = 1 / 6;
    return function noise3D(x, y, z) {
      const ss = (x + y + z) * F3;
      const i = Math.floor(x + ss), j = Math.floor(y + ss), k = Math.floor(z + ss);
      const tt = (i + j + k) * G3;
      const x0 = x - (i - tt), y0 = y - (j - tt), z0 = z - (k - tt);

      let i1, j1, k1, i2, j2, k2;
      if (x0 >= y0) {
        if      (y0 >= z0) { i1=1; j1=0; k1=0; i2=1; j2=1; k2=0; }
        else if (x0 >= z0) { i1=1; j1=0; k1=0; i2=1; j2=0; k2=1; }
        else               { i1=0; j1=0; k1=1; i2=1; j2=0; k2=1; }
      } else {
        if      (y0 <  z0) { i1=0; j1=0; k1=1; i2=0; j2=1; k2=1; }
        else if (x0 <  z0) { i1=0; j1=1; k1=0; i2=0; j2=1; k2=1; }
        else               { i1=0; j1=1; k1=0; i2=1; j2=1; k2=0; }
      }
      const x1 = x0 - i1 +     G3, y1 = y0 - j1 +     G3, z1 = z0 - k1 +     G3;
      const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
      const x3 = x0 - 1  + 3 * G3, y3 = y0 - 1  + 3 * G3, z3 = z0 - 1  + 3 * G3;

      const ii = i & 255, jj = j & 255, kk = k & 255;
      const gi0 = (perm[ii      + perm[jj      + perm[kk     ]]] % 12) * 3;
      const gi1 = (perm[ii + i1 + perm[jj + j1 + perm[kk + k1]]] % 12) * 3;
      const gi2 = (perm[ii + i2 + perm[jj + j2 + perm[kk + k2]]] % 12) * 3;
      const gi3 = (perm[ii + 1  + perm[jj + 1  + perm[kk + 1 ]]] % 12) * 3;

      let n0, n1, n2, n3;
      let t0 = 0.6 - x0*x0 - y0*y0 - z0*z0;
      if (t0 < 0) n0 = 0;
      else { t0 *= t0; n0 = t0 * t0 * (grad3[gi0]*x0 + grad3[gi0+1]*y0 + grad3[gi0+2]*z0); }
      let t1 = 0.6 - x1*x1 - y1*y1 - z1*z1;
      if (t1 < 0) n1 = 0;
      else { t1 *= t1; n1 = t1 * t1 * (grad3[gi1]*x1 + grad3[gi1+1]*y1 + grad3[gi1+2]*z1); }
      let t2 = 0.6 - x2*x2 - y2*y2 - z2*z2;
      if (t2 < 0) n2 = 0;
      else { t2 *= t2; n2 = t2 * t2 * (grad3[gi2]*x2 + grad3[gi2+1]*y2 + grad3[gi2+2]*z2); }
      let t3 = 0.6 - x3*x3 - y3*y3 - z3*z3;
      if (t3 < 0) n3 = 0;
      else { t3 *= t3; n3 = t3 * t3 * (grad3[gi3]*x3 + grad3[gi3+1]*y3 + grad3[gi3+2]*z3); }
      return 32 * (n0 + n1 + n2 + n3);
    };
  }

  /* ── Vortex animation class ──────────────────────────────────────── */
  class Vortex {
    constructor(canvas, opts) {
      this.canvas = canvas;
      this.ctx    = canvas.getContext && canvas.getContext('2d');
      if (!this.ctx) {
        // Headless browsers, strict privacy modes, or out-of-memory canvases
        // can return null. Bail silently — the rest of the site keeps working.
        // eslint-disable-next-line no-console
        console.warn('[vortex] 2D canvas unavailable; particle background disabled');
        return;
      }
      this.opts   = Object.assign({
        particleCount:   500,
        rangeY:          100,
        baseHue:         220,
        rangeHue:        50,
        baseSpeed:       0.0,
        rangeSpeed:      1.5,
        baseRadius:      1,
        rangeRadius:     2,
        baseTTL:         50,
        rangeTTL:        150,
        backgroundColor: 'transparent',
      }, opts || {});

      this.PROP_COUNT = 9;
      this.noise3D    = makeNoise3D();
      this.tick       = 0;
      this.center     = [0, 0];
      this.particleProps = new Float32Array(this.opts.particleCount * this.PROP_COUNT);
      this.rafId      = null;
      this.paused     = false;

      this._loop     = this._loop.bind(this);
      this._onResize = this._onResize.bind(this);

      this._onResize();
      this._initParticles();
      window.addEventListener('resize', this._onResize);
      this.rafId = requestAnimationFrame(this._loop);
    }

    /* Public API */
    setHue(baseHue, rangeHue) {
      if (!this.ctx) return;
      const oldBase  = this.opts.baseHue;
      const oldRange = this.opts.rangeHue;
      this.opts.baseHue  = baseHue;
      if (typeof rangeHue === 'number') this.opts.rangeHue = rangeHue;
      // Re-tint living particles by remapping their hue from the OLD
      // [oldBase, oldBase+oldRange] band onto the new [baseHue, baseHue+rangeHue]
      // band. This makes subject switches visible immediately instead of
      // waiting ~5s for natural particle turnover.
      const props = this.particleProps;
      for (let i = 8; i < props.length; i += this.PROP_COUNT) {
        const t = oldRange > 0 ? (props[i] - oldBase) / oldRange : 0;
        props[i] = baseHue + t * this.opts.rangeHue;
      }
    }
    pause()   { this.paused = true; if (this.rafId) cancelAnimationFrame(this.rafId); }
    resume()  {
      if (!this.ctx || !this.paused) return;
      this.paused = false;
      this.rafId = requestAnimationFrame(this._loop);
    }
    destroy() {
      if (this.rafId) cancelAnimationFrame(this.rafId);
      window.removeEventListener('resize', this._onResize);
    }

    /* Internals */
    _onResize() {
      // Use devicePixelRatio for crisp rendering on hi-dpi screens, capped
      // at 2 to keep blur passes affordable.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = window.innerWidth, h = window.innerHeight;
      this.canvas.width  = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.canvas.style.width  = w + 'px';
      this.canvas.style.height = h + 'px';
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.center[0] = w * 0.5;
      this.center[1] = h * 0.5;
      this._cssW = w;
      this._cssH = h;
    }

    _initParticles() {
      this.tick = 0;
      for (let i = 0; i < this.particleProps.length; i += this.PROP_COUNT) {
        this._initParticle(i);
      }
    }
    _initParticle(i) {
      const o = this.opts;
      const x  = Math.random() * this._cssW;
      const y  = this.center[1] + (Math.random() * 2 - 1) * o.rangeY;
      // Seed a small initial velocity so the very first rendered line is
      // non-degenerate. Without this the first frame draws zero-length
      // strokes which some browsers skip entirely.
      const angle = Math.random() * Math.PI * 2;
      this.particleProps[i  ] = x;
      this.particleProps[i+1] = y;
      this.particleProps[i+2] = Math.cos(angle) * 0.5;
      this.particleProps[i+3] = Math.sin(angle) * 0.5;
      this.particleProps[i+4] = 0;
      this.particleProps[i+5] = o.baseTTL    + Math.random() * o.rangeTTL;
      this.particleProps[i+6] = o.baseSpeed  + Math.random() * o.rangeSpeed;
      this.particleProps[i+7] = o.baseRadius + Math.random() * o.rangeRadius;
      this.particleProps[i+8] = o.baseHue    + Math.random() * o.rangeHue;
    }

    _loop() {
      if (this.paused) return;
      this.tick++;
      const ctx = this.ctx, w = this._cssW, h = this._cssH;

      ctx.clearRect(0, 0, w, h);
      if (this.opts.backgroundColor !== 'transparent') {
        ctx.fillStyle = this.opts.backgroundColor;
        ctx.fillRect(0, 0, w, h);
      }
      this._drawParticles();
      this._renderGlow(w, h);
      this._renderToScreen(w, h);

      this.rafId = requestAnimationFrame(this._loop);
    }

    _drawParticles() {
      const props = this.particleProps;
      for (let i = 0; i < props.length; i += this.PROP_COUNT) {
        this._updateParticle(i);
      }
    }

    _updateParticle(i) {
      const xOff = 0.00125, yOff = 0.00125, zOff = 0.0005, noiseSteps = 3;
      const TAU = Math.PI * 2;
      const props = this.particleProps;

      const x = props[i], y = props[i+1];
      const n = this.noise3D(x * xOff, y * yOff, this.tick * zOff) * noiseSteps * TAU;
      const vx = (props[i+2] + Math.cos(n)) * 0.5;
      const vy = (props[i+3] + Math.sin(n)) * 0.5;
      const life   = props[i+4];
      const ttl    = props[i+5];
      const speed  = props[i+6];
      const radius = props[i+7];
      const hue    = props[i+8];
      const x2 = x + vx * speed, y2 = y + vy * speed;

      this._drawParticle(x, y, x2, y2, life, ttl, radius, hue);

      props[i  ] = x2;
      props[i+1] = y2;
      props[i+2] = vx;
      props[i+3] = vy;
      props[i+4] = life + 1;

      if (x2 < 0 || x2 > this._cssW || y2 < 0 || y2 > this._cssH || life > ttl) {
        this._initParticle(i);
      }
    }

    _drawParticle(x, y, x2, y2, life, ttl, radius, hue) {
      const ctx = this.ctx;
      const hm = ttl * 0.5;
      const fade = Math.abs(((life + hm) % ttl) - hm) / hm;
      ctx.save();
      ctx.lineCap     = 'round';
      ctx.lineWidth   = radius;
      ctx.strokeStyle = 'hsla(' + hue.toFixed(0) + ',100%,60%,' + fade.toFixed(3) + ')';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.restore();
    }

    _renderGlow(w, h) {
      const ctx = this.ctx;
      ctx.save();
      ctx.filter = 'blur(8px) brightness(200%)';
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(this.canvas, 0, 0, w, h);
      ctx.restore();

      ctx.save();
      ctx.filter = 'blur(4px) brightness(200%)';
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(this.canvas, 0, 0, w, h);
      ctx.restore();
    }

    _renderToScreen(w, h) {
      const ctx = this.ctx;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(this.canvas, 0, 0, w, h);
      ctx.restore();
    }
  }

  /* ── Bootstrap: inject canvas + observe subject changes ──────────── */
  function getSubjectConfig() {
    const subj = document.documentElement.getAttribute('data-subject') || 'Biology';
    return SUBJECT_HUES[subj] || SUBJECT_HUES.Biology;
  }

  function init() {
    if (document.getElementById('vortex-canvas')) return;

    const canvas = document.createElement('canvas');
    canvas.id = 'vortex-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.insertBefore(canvas, document.body.firstChild);

    // Halve particle count on small screens; further dial down on phones.
    const w = window.innerWidth;
    const particleCount = w < 480 ? 180 : w < 900 ? 320 : 500;

    const cfg = getSubjectConfig();
    const vortex = new Vortex(canvas, {
      particleCount: particleCount,
      baseHue:       cfg.baseHue,
      rangeHue:      cfg.rangeHue,
      backgroundColor: 'transparent',
    });

    // eslint-disable-next-line no-console
    console.log('[vortex] active —', particleCount, 'particles, hue', cfg.baseHue);

    // Re-tune hue when the user picks a different subject.
    if (window.MutationObserver) {
      const mo = new MutationObserver(() => {
        const c = getSubjectConfig();
        vortex.setHue(c.baseHue, c.rangeHue);
      });
      mo.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-subject'],
      });
    }

    // Pause when tab is hidden — saves CPU + battery.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) vortex.pause(); else vortex.resume();
    });

    window.Vortex = vortex; // expose for debugging
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
