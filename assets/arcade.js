/* ============================================================
   CARTRIDGE — shared arcade runtime
   Tiny zero-dependency helpers used by every game on the site.
   ============================================================ */
(function (global) {
  'use strict';

  /* ---------- math ---------- */
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const inv = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
  const smooth = (t) => t * t * (3 - 2 * t);
  const TAU = Math.PI * 2;
  const dist2 = (ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay;
    return dx * dx + dy * dy;
  };
  const dist = (ax, ay, bx, by) => Math.sqrt(dist2(ax, ay, bx, by));
  // Frame-rate independent exponential approach. `rate` = fraction remaining after 1s.
  const approach = (cur, target, rate, dt) => target + (cur - target) * Math.pow(rate, dt);

  /* ---------- deterministic RNG (mulberry32) ---------- */
  function hashStr(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function Rng(seed) {
    let a = (typeof seed === 'string' ? hashStr(seed) : seed >>> 0) || 1;
    const next = () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.range = (lo, hi) => lo + next() * (hi - lo);
    next.int = (lo, hi) => Math.floor(lo + next() * (hi - lo + 1)); // inclusive
    next.pick = (arr) => arr[Math.floor(next() * arr.length)];
    next.chance = (p) => next() < p;
    next.shuffle = (arr) => {
      const out = arr.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    };
    next.sign = () => (next() < 0.5 ? -1 : 1);
    return next;
  }

  /* ---------- persistence ---------- */
  const Store = {
    ns: 'cartridge',
    key(k) { return this.ns + ':' + k; },
    get(k, dflt) {
      try {
        const raw = localStorage.getItem(this.key(k));
        return raw === null ? dflt : JSON.parse(raw);
      } catch (e) { return dflt; }
    },
    set(k, v) {
      try { localStorage.setItem(this.key(k), JSON.stringify(v)); return true; }
      catch (e) { return false; }
    },
    del(k) { try { localStorage.removeItem(this.key(k)); } catch (e) {} },
  };

  /* ---------- audio: a very small synth ---------- */
  /* Everything is generated at runtime — the site ships no audio files. */
  class AudioKit {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.muted = Store.get('muted', false);
      this._unlocked = false;
    }
    init() {
      if (this.ctx) return this.ctx;
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.55;

      // A soft limiter so stacked voices never clip.
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 20;
      comp.ratio.value = 8;
      comp.attack.value = 0.003;
      comp.release.value = 0.25;

      // Shared ambience send: a short feedback delay.
      this.wet = this.ctx.createGain();
      this.wet.gain.value = 0.0;
      const dly = this.ctx.createDelay(1.0);
      dly.delayTime.value = 0.22;
      const fb = this.ctx.createGain();
      fb.gain.value = 0.32;
      const damp = this.ctx.createBiquadFilter();
      damp.type = 'lowpass';
      damp.frequency.value = 2200;
      this.wet.connect(dly); dly.connect(damp); damp.connect(fb); fb.connect(dly);
      damp.connect(this.master);

      this.master.connect(comp);
      comp.connect(this.ctx.destination);
      return this.ctx;
    }
    // Browsers require a gesture before audio starts; call from any input handler.
    unlock() {
      this.init();
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') this.ctx.resume();
      this._unlocked = true;
    }
    setReverb(amount) { if (this.wet) this.wet.gain.value = amount; }
    get t() { return this.ctx ? this.ctx.currentTime : 0; }
    setMuted(m) {
      this.muted = m;
      Store.set('muted', m);
      if (this.master) {
        this.master.gain.cancelScheduledValues(this.t);
        this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.t, 0.02);
      }
    }
    toggleMute() { this.setMuted(!this.muted); return this.muted; }

    /* A single enveloped oscillator voice. */
    tone(opt) {
      if (!this.ctx || this.muted) return;
      const o = Object.assign({
        freq: 440, to: null, dur: 0.18, type: 'sine', gain: 0.3,
        delay: 0, attack: 0.004, hold: 0, curve: 'exp',
        detune: 0, send: 0, pan: 0,
      }, opt);
      const t0 = this.t + o.delay;
      const osc = this.ctx.createOscillator();
      osc.type = o.type;
      osc.frequency.setValueAtTime(Math.max(1, o.freq), t0);
      if (o.to != null) {
        if (o.curve === 'exp') osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t0 + o.dur);
        else osc.frequency.linearRampToValueAtTime(Math.max(1, o.to), t0 + o.dur);
      }
      if (o.detune) osc.detune.setValueAtTime(o.detune, t0);

      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), t0 + o.attack);
      if (o.hold) g.gain.setValueAtTime(Math.max(0.0002, o.gain), t0 + o.attack + o.hold);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.attack + o.hold + o.dur);

      let node = g;
      if (o.pan && this.ctx.createStereoPanner) {
        const p = this.ctx.createStereoPanner();
        p.pan.value = clamp(o.pan, -1, 1);
        g.connect(p);
        node = p;
      }
      osc.connect(g);
      node.connect(this.master);
      if (o.send > 0 && this.wet) node.connect(this.wet);
      osc.start(t0);
      osc.stop(t0 + o.attack + o.hold + o.dur + 0.05);
    }

    /* Filtered noise burst — impacts, wind, static. */
    noise(opt) {
      if (!this.ctx || this.muted) return;
      const o = Object.assign({
        dur: 0.2, gain: 0.25, delay: 0, type: 'lowpass',
        freq: 1200, to: null, q: 1, attack: 0.002, send: 0,
      }, opt);
      const t0 = this.t + o.delay;
      const len = Math.max(1, Math.ceil(this.ctx.sampleRate * (o.dur + 0.05)));
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;

      const f = this.ctx.createBiquadFilter();
      f.type = o.type;
      f.Q.value = o.q;
      f.frequency.setValueAtTime(Math.max(20, o.freq), t0);
      if (o.to != null) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t0 + o.dur);

      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), t0 + o.attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);

      src.connect(f); f.connect(g); g.connect(this.master);
      if (o.send > 0 && this.wet) g.connect(this.wet);
      src.start(t0);
      src.stop(t0 + o.dur + 0.05);
    }

    chord(freqs, opt) {
      freqs.forEach((f, i) =>
        this.tone(Object.assign({}, opt, { freq: f, delay: (opt.delay || 0) + i * (opt.spread || 0) })));
    }
  }

  /* ---------- input ---------- */
  class Keys {
    constructor(target) {
      this.down = Object.create(null);
      this.pressed = Object.create(null);
      this.released = Object.create(null);
      this._onDown = (e) => {
        const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        if (!this.down[k]) this.pressed[k] = true;
        this.down[k] = true;
        if (this.swallow && this.swallow(k, e)) e.preventDefault();
      };
      this._onUp = (e) => {
        const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        this.down[k] = false;
        this.released[k] = true;
      };
      this._onBlur = () => { this.down = Object.create(null); };
      (target || global).addEventListener('keydown', this._onDown);
      (target || global).addEventListener('keyup', this._onUp);
      global.addEventListener('blur', this._onBlur);
      // Keys that should never scroll the page during play.
      this.swallow = (k) => [' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k);
    }
    // True on the frame a key went down. Call endFrame() once per tick.
    hit(...ks) { return ks.some((k) => this.pressed[k]); }
    held(...ks) { return ks.some((k) => this.down[k]); }
    let_go(...ks) { return ks.some((k) => this.released[k]); }
    endFrame() {
      this.pressed = Object.create(null);
      this.released = Object.create(null);
    }
  }

  /* ---------- particles ---------- */
  class Particles {
    constructor(max = 900) {
      this.max = max;
      this.p = [];
    }
    spawn(o) {
      if (this.p.length >= this.max) this.p.shift();
      this.p.push(Object.assign({
        x: 0, y: 0, vx: 0, vy: 0, life: 1, max: 1,
        r: 2, r2: 0, grav: 0, drag: 0.9, color: '#fff',
        glow: 0, shape: 'circle', spin: 0, rot: 0,
      }, o));
    }
    burst(x, y, n, o) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU;
        const s = lerp(o.spdMin || 30, o.spdMax || 180, Math.random());
        this.spawn(Object.assign({}, o, {
          x: x + (o.jitter ? (Math.random() - 0.5) * o.jitter : 0),
          y: y + (o.jitter ? (Math.random() - 0.5) * o.jitter : 0),
          vx: Math.cos(a) * s + (o.vx || 0),
          vy: Math.sin(a) * s + (o.vy || 0),
          life: lerp(o.lifeMin || 0.3, o.lifeMax || 0.8, Math.random()),
        }));
        this.p[this.p.length - 1].max = this.p[this.p.length - 1].life;
      }
    }
    update(dt) {
      for (let i = this.p.length - 1; i >= 0; i--) {
        const q = this.p[i];
        q.life -= dt;
        if (q.life <= 0) { this.p.splice(i, 1); continue; }
        q.vy += q.grav * dt;
        const d = Math.pow(q.drag, dt * 60);
        q.vx *= d; q.vy *= d;
        q.x += q.vx * dt; q.y += q.vy * dt;
        q.rot += q.spin * dt;
      }
    }
    draw(ctx) {
      ctx.save();
      for (const q of this.p) {
        const t = clamp(q.life / q.max, 0, 1);
        ctx.globalAlpha = t;
        ctx.fillStyle = q.color;
        if (q.glow) { ctx.shadowBlur = q.glow; ctx.shadowColor = q.color; }
        else ctx.shadowBlur = 0;
        const r = lerp(q.r2 || 0, q.r, t);
        if (q.shape === 'square') {
          ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.rot);
          ctx.fillRect(-r, -r, r * 2, r * 2); ctx.restore();
        } else if (q.shape === 'line') {
          ctx.strokeStyle = q.color; ctx.lineWidth = Math.max(0.5, r);
          ctx.beginPath(); ctx.moveTo(q.x, q.y);
          ctx.lineTo(q.x - q.vx * 0.03, q.y - q.vy * 0.03); ctx.stroke();
        } else {
          ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(0.1, r), 0, TAU); ctx.fill();
        }
      }
      ctx.restore();
    }
    clear() { this.p.length = 0; }
  }

  /* ---------- canvas ---------- */
  // Sizes a canvas to its CSS box at device pixel ratio, and keeps the 2d
  // context in CSS-pixel coordinates. Returns {w,h} in CSS pixels.
  function fitCanvas(canvas, ctx, maxDpr = 2) {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(global.devicePixelRatio || 1, maxDpr);
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h, dpr };
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  /* ---------- main loop with fixed-step option ---------- */
  // step: called with a fixed dt (deterministic sims). render: called with alpha.
  function Loop({ step, render, hz = 60, maxFrame = 0.25 }) {
    const fixed = 1 / hz;
    let acc = 0, last = 0, raf = 0, running = false;
    function frame(now) {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      const t = now / 1000;
      let dt = last ? t - last : fixed;
      last = t;
      if (dt > maxFrame) dt = maxFrame; // tab regained focus — don't spiral
      acc += dt;
      let guard = 0;
      while (acc >= fixed && guard++ < 8) { step(fixed); acc -= fixed; }
      render(acc / fixed, dt);
    }
    return {
      start() { if (running) return; running = true; last = 0; acc = 0; raf = requestAnimationFrame(frame); },
      stop() { running = false; cancelAnimationFrame(raf); },
      get running() { return running; },
    };
  }

  /* ---------- misc ---------- */
  function fmtTime(sec) {
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ':' + String(s).padStart(2, '0');
  }
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const k in (attrs || {})) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    }
    kids.flat().forEach((c) => n.append(c && c.nodeType ? c : document.createTextNode(c)));
    return n;
  }

  // Standard mute button + back link wired into every game's chrome.
  function mountChrome(audio, { onMute } = {}) {
    const btn = document.getElementById('muteBtn');
    if (!btn) return;
    const paint = () => { btn.textContent = audio.muted ? 'sound off' : 'sound on'; btn.dataset.on = String(!audio.muted); };
    paint();
    btn.addEventListener('click', () => {
      audio.unlock();
      audio.toggleMute();
      paint();
      if (onMute) onMute(audio.muted);
    });
    global.addEventListener('keydown', (e) => {
      if (e.key === 'm' || e.key === 'M') {
        if (document.activeElement && /input|textarea/i.test(document.activeElement.tagName)) return;
        audio.unlock(); audio.toggleMute(); paint();
      }
    });
  }

  global.Arcade = {
    clamp, lerp, inv, smooth, approach, dist, dist2, TAU,
    Rng, hashStr, Store, AudioKit, Keys, Particles,
    fitCanvas, roundRect, Loop, fmtTime, el, mountChrome,
  };
})(window);
