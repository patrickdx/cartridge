/* ============================================================
   CARTRIDGE — hub
   Builds the shelf and animates a live miniature of each game.
   ============================================================ */
(function () {
  'use strict';

  const A = window.Arcade;
  const { clamp, lerp, TAU, Store, Rng } = A;
  const audio = new A.AudioKit();

  /* ---------------------------------------------------------
     catalogue
     --------------------------------------------------------- */
  const GAMES = [
    {
      id: 'chrono-echo',
      kicker: 'Puzzle platformer',
      title: 'Chrono Echo',
      color: '#5df2d6',
      pitch: 'You get one body, but you get it several times. Each loop records a take; ' +
             'every take you have already made replays beside you as a solid thing you can ' +
             'stand on and ride. Rewind mid-run to branch a timeline — then build your own ' +
             'levels in the forge and share them as a link.',
      tags: ['keyboard', '9 levels', 'time loops', 'level editor'],
      best() {
        const p = Store.get('ce:progress', {});
        const done = Object.keys(p).length;
        return done ? `<b>${done}</b>/9 fractures closed` : 'not started';
      },
      draw: drawChronoThumb,
    },
    {
      id: 'orbital-drift',
      kicker: 'Physics arcade',
      title: 'Orbital Drift',
      color: '#7fb2ff',
      pitch: 'A probe with no engine worth mentioning, loose in a gravity well. ' +
             'Your only real control is choosing what to fall toward — grab a world with ' +
             'the tractor beam, swing around it, and let go at exactly the right moment. ' +
             'Pulsars fire on a beat; wormholes come in pairs.',
      tags: ['mouse', 'endless', 'n-body gravity', 'one button'],
      best() {
        const b = Store.get('od:best', null);
        return b ? `best <b>${b.score.toLocaleString()}</b> · ${b.sectors} sectors` : 'not started';
      },
      draw: drawOrbitThumb,
    },
    {
      id: 'cold-spot',
      kicker: 'Deduction',
      title: 'Cold Spot',
      color: '#e0b070',
      pitch: 'Something is in the house and it is in exactly one room. You have instruments, ' +
             'each with a limited charge and its own kind of half-answer. Narrow it down, ' +
             'commit to a room, and hope your logic was tighter than the dark.',
      tags: ['mouse', 'procedural', 'pure logic', 'no reflexes'],
      best() {
        const s = Store.get('cs:stats', null);
        return s && s.solved ? `<b>${s.solved}</b> solved · streak ${s.bestStreak}` : 'not started';
      },
      draw: drawGhostThumb,
    },
  ];

  /* ---------------------------------------------------------
     build the shelf
     --------------------------------------------------------- */
  const shelf = document.getElementById('shelf');
  const thumbs = [];

  GAMES.forEach((g) => {
    const a = document.createElement('a');
    a.className = 'card';
    a.href = `games/${g.id}/index.html`;
    a.style.setProperty('--c', g.color);
    a.innerHTML = `
      <div class="thumb"><canvas></canvas></div>
      <div class="body">
        <div class="kicker">${g.kicker}</div>
        <h2>${g.title}</h2>
        <p class="pitch">${g.pitch}</p>
        <div class="tags">${g.tags.map((t) => `<span class="tag">${t}</span>`).join('')}</div>
        <div class="foot">
          <span class="best">${g.best()}</span>
          <span class="play">play <span class="arrow">→</span></span>
        </div>
      </div>`;
    shelf.appendChild(a);
    const c = a.querySelector('canvas');
    thumbs.push({ g, canvas: c, ctx: c.getContext('2d'), rng: Rng(g.id) });

    // a small blip when you hover a cartridge
    a.addEventListener('pointerenter', () => {
      audio.unlock();
      audio.tone({ freq: 520, to: 760, dur: 0.1, type: 'triangle', gain: 0.05 });
    });
  });

  /* ---------------------------------------------------------
     thumbnails
     --------------------------------------------------------- */

  // Chrono Echo: a runner and two lagging echoes crossing platforms.
  function drawChronoThumb(ctx, w, h, t) {
    ctx.fillStyle = '#0a0c18';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    const gs = w / 16;
    ctx.beginPath();
    for (let x = 0; x < w; x += gs) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h); }
    for (let y = 0; y < h; y += gs) { ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); }
    ctx.stroke();

    const plats = [
      { x: 0.04, y: 0.80, w: 0.34 },
      { x: 0.42, y: 0.62, w: 0.26 },
      { x: 0.72, y: 0.44, w: 0.26 },
    ];
    plats.forEach((p) => {
      const px = p.x * w, py = p.y * h, pw = p.w * w;
      ctx.fillStyle = '#1a2039';
      ctx.fillRect(px, py, pw, h * 0.055);
      ctx.fillStyle = '#3a4a80';
      ctx.fillRect(px, py, pw, 2);
    });

    // one path, sampled at three offsets in time
    const period = 4.2;
    function posAt(u) {
      u = ((u % period) + period) % period;
      const k = u / period;
      const seg = Math.min(2, Math.floor(k * 3));
      const local = clamp(k * 3 - seg, 0, 1);
      const from = plats[seg], to = plats[Math.min(2, seg + 1)];
      const x = lerp(from.x + from.w * 0.5, to.x + to.w * 0.5, local) * w;
      const base = lerp(from.y, to.y, local) * h;
      const hop = Math.sin(local * Math.PI) * h * 0.16;
      return { x, y: base - hop };
    }

    const bodyW = w * 0.035, bodyH = h * 0.10;
    const ECHO = ['#b06bff', '#ff6bd6'];
    for (let i = 2; i >= 1; i--) {
      const p = posAt(t - i * 0.55);
      ctx.globalAlpha = 0.42 - i * 0.08;
      ctx.fillStyle = ECHO[i - 1];
      ctx.shadowBlur = 14; ctx.shadowColor = ECHO[i - 1];
      A.roundRect(ctx, p.x - bodyW / 2, p.y - bodyH, bodyW, bodyH, 3);
      ctx.fill();
    }
    ctx.globalAlpha = 1; ctx.shadowBlur = 16; ctx.shadowColor = '#5df2d6';
    const p0 = posAt(t);
    ctx.fillStyle = '#5df2d6';
    A.roundRect(ctx, p0.x - bodyW / 2, p0.y - bodyH, bodyW, bodyH, 3);
    ctx.fill();
    ctx.shadowBlur = 0;

    // the orb it is running toward
    const ox = 0.855 * w, oy = 0.36 * h;
    const pulse = 1 + Math.sin(t * 3) * 0.12;
    const gr = ctx.createRadialGradient(ox, oy, 0, ox, oy, 9 * pulse);
    gr.addColorStop(0, '#fff3d0'); gr.addColorStop(0.5, '#ffcc55');
    gr.addColorStop(1, 'rgba(255,180,60,0)');
    ctx.fillStyle = gr;
    ctx.beginPath(); ctx.arc(ox, oy, 9 * pulse, 0, TAU); ctx.fill();
  }

  // Orbital Drift: a probe whipping around a planet, tether flickering on.
  function drawOrbitThumb(ctx, w, h, t) {
    ctx.fillStyle = '#04060f';
    ctx.fillRect(0, 0, w, h);

    const rng = Rng('od-stars');
    for (let i = 0; i < 70; i++) {
      const x = rng() * w, y = rng() * h, r = rng() * 1.1 + 0.25;
      ctx.globalAlpha = 0.25 + Math.abs(Math.sin(t * 0.7 + i)) * 0.55;
      ctx.fillStyle = i % 9 === 0 ? '#9fd0ff' : '#ffffff';
      ctx.fillRect(x, y, r, r);
    }
    ctx.globalAlpha = 1;

    const cx = w * 0.42, cy = h * 0.56, R = h * 0.19;
    // planet
    const pg = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
    pg.addColorStop(0, '#6f8ff0'); pg.addColorStop(0.6, '#33478f'); pg.addColorStop(1, '#141c3c');
    ctx.fillStyle = pg;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(127,178,255,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, R + 4, 0, TAU); ctx.stroke();

    // eccentric orbit, drawn as a fading trail
    const a = R * 3.1, b = R * 1.55, tilt = -0.42;
    const at = (u) => {
      const e = u * 1.15;
      const x = Math.cos(e) * a, y = Math.sin(e) * b;
      return { x: cx + x * Math.cos(tilt) - y * Math.sin(tilt),
               y: cy + x * Math.sin(tilt) + y * Math.cos(tilt) };
    };
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 46; i++) {
      const p1 = at(t - i * 0.028), p2 = at(t - (i + 1) * 0.028);
      ctx.globalAlpha = (1 - i / 46) * 0.5;
      ctx.strokeStyle = '#7fb2ff';
      ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    const p = at(t);
    // tether pulses on during the near pass
    const near = A.dist(p.x, p.y, cx, cy) < R * 2.4;
    if (near) {
      ctx.strokeStyle = 'rgba(127,178,255,0.75)';
      ctx.setLineDash([3, 4]);
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(cx, cy); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.shadowBlur = 14; ctx.shadowColor = '#cfe4ff';
    ctx.fillStyle = '#eaf3ff';
    ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, TAU); ctx.fill();
    ctx.shadowBlur = 0;
  }

  // Cold Spot: a floorplan with a cold reading blooming in one room.
  function drawGhostThumb(ctx, w, h, t) {
    ctx.fillStyle = '#0d0a08';
    ctx.fillRect(0, 0, w, h);

    const cols = 5, rows = 3;
    const pad = w * 0.09;
    const cw = (w - pad * 2) / cols, ch = (h - pad * 2) / rows;
    const secret = 8; // room index that runs cold

    for (let i = 0; i < cols * rows; i++) {
      const cx = pad + (i % cols) * cw, cy = pad + Math.floor(i / cols) * ch;
      const isIt = i === secret;
      const beat = (Math.sin(t * 1.5) + 1) / 2;
      ctx.fillStyle = isIt ? `rgba(120,190,220,${0.05 + beat * 0.20})` : 'rgba(255,240,215,0.028)';
      ctx.fillRect(cx + 2, cy + 2, cw - 4, ch - 4);
      ctx.strokeStyle = isIt ? `rgba(150,215,255,${0.25 + beat * 0.5})` : 'rgba(224,176,112,0.20)';
      ctx.lineWidth = 1;
      ctx.strokeRect(cx + 2.5, cy + 2.5, cw - 5, ch - 5);

      // little furniture ticks so the rooms read as rooms
      const r = Rng('room' + i);
      ctx.fillStyle = 'rgba(224,176,112,0.22)';
      for (let k = 0; k < 2; k++) {
        ctx.fillRect(cx + 7 + r() * (cw - 20), cy + 7 + r() * (ch - 18), 4, 3);
      }
    }

    // candlelight vignette that breathes
    const flick = 0.86 + Math.sin(t * 9) * 0.05 + Math.sin(t * 23) * 0.03;
    const vg = ctx.createRadialGradient(w * 0.5, h * 0.5, h * 0.1, w * 0.5, h * 0.5, h * flick);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.85)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);

    // a thermometer needle swinging toward cold
    const bx = w * 0.5, by = h * 0.90;
    ctx.strokeStyle = 'rgba(224,176,112,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(bx - w * 0.16, by); ctx.lineTo(bx + w * 0.16, by); ctx.stroke();
    const nx = bx + Math.sin(t * 0.9) * w * 0.14;
    ctx.strokeStyle = '#9ad7ff';
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(nx, by - 5); ctx.lineTo(nx, by + 4); ctx.stroke();
  }

  /* ---------------------------------------------------------
     background field
     --------------------------------------------------------- */
  const bg = document.getElementById('bg');
  const bgx = bg.getContext('2d');
  const dust = [];

  function seedDust(w, h) {
    dust.length = 0;
    const n = Math.round(clamp((w * h) / 14000, 40, 150));
    const r = Rng('dust');
    for (let i = 0; i < n; i++) {
      dust.push({
        x: r() * w, y: r() * h,
        z: r() * 0.8 + 0.2,
        s: r() * 1.6 + 0.4,
        hue: r() < 0.12 ? '#b06bff' : r() < 0.3 ? '#5df2d6' : '#8ea0c8',
      });
    }
  }

  function drawBg(w, h, t, dt) {
    bgx.fillStyle = '#07070c';
    bgx.fillRect(0, 0, w, h);

    // slow diagonal grid
    bgx.save();
    bgx.globalAlpha = 0.05;
    bgx.strokeStyle = '#6f7db5';
    bgx.lineWidth = 1;
    const gap = 74;
    const off = (t * 7) % gap;
    bgx.beginPath();
    for (let x = -h; x < w + h; x += gap) {
      bgx.moveTo(x + off, 0); bgx.lineTo(x + off + h, h);
    }
    bgx.stroke();
    bgx.restore();

    for (const d of dust) {
      d.y -= d.z * 11 * dt;
      if (d.y < -4) { d.y = h + 4; d.x = Math.random() * w; }
      bgx.globalAlpha = 0.10 + d.z * 0.34;
      bgx.fillStyle = d.hue;
      bgx.fillRect(d.x, d.y, d.s, d.s);
    }
    bgx.globalAlpha = 1;

    // warm pool of light behind the masthead
    const g = bgx.createRadialGradient(w * 0.5, -h * 0.15, 0, w * 0.5, -h * 0.15, h * 0.9);
    g.addColorStop(0, 'rgba(80,110,200,0.16)');
    g.addColorStop(1, 'rgba(80,110,200,0)');
    bgx.fillStyle = g;
    bgx.fillRect(0, 0, w, h);
  }

  /* ---------------------------------------------------------
     loop
     --------------------------------------------------------- */
  let last = 0;
  let bgSize = { w: 0, h: 0 };
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function frame(now) {
    requestAnimationFrame(frame);
    const t = now / 1000;
    const dt = Math.min(0.05, last ? t - last : 0.016);
    last = t;

    const b = A.fitCanvas(bg, bgx, 1.5);
    if (b.w !== bgSize.w || b.h !== bgSize.h) { bgSize = b; seedDust(b.w, b.h); }
    drawBg(b.w, b.h, reduced ? 0 : t, reduced ? 0 : dt);

    for (const th of thumbs) {
      const r = th.canvas.getBoundingClientRect();
      if (r.bottom < -80 || r.top > window.innerHeight + 80) continue; // offscreen
      const s = A.fitCanvas(th.canvas, th.ctx, 2);
      th.g.draw(th.ctx, s.w, s.h, reduced ? 1.2 : t);
    }
  }

  A.mountChrome(audio);
  requestAnimationFrame(frame);
})();
