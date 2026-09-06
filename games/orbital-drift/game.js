/* ============================================================
   ORBITAL DRIFT
   A probe with no engine worth mentioning, loose in a gravity well.

   Every body pulls on you all the time. Holding the mouse tethers the
   world nearest your cursor and multiplies its pull — so the only real
   decision in the game is which way to fall, and when to stop falling
   that way. A forward simulation of the same integrator draws your
   actual future as a dotted line, which is what makes it a game of
   skill rather than a game of hope.
   ============================================================ */
(function () {
  'use strict';

  const A = window.Arcade;
  const { clamp, lerp, approach, TAU, Store, Rng } = A;

  /* ---------------------------------------------------------
     constants
     --------------------------------------------------------- */
  const VW = 960, VH = 540;
  const HZ = 60, DT = 1 / HZ, SUB = 4;      // 4 substeps => 240 Hz physics

  const MU_K = 8;            // gravitational parameter = MU_K * r^3
  const SOFT = 26;           // softening, keeps the singularity finite
  const TETHER_MULT = 4.5;
  const BEACON_PULL = 900;
  const MAX_ACC = 5200;
  const MAX_SPEED = 950;
  const CRASH_SPEED = 120;   // below this, contact is a survivable bump
  const BURN_ACC = 720;
  const BURN_COST = 26;      // fuel per second
  const PRED_STEPS = 165;    // ~2.75 s of predicted flight

  const GRAZE_IN = 1.75, GRAZE_OUT = 2.3;

  // Pulsars fire an expanding ring that shoves you outward as it passes.
  const PULSE_THICK = 52;    // how wide the shock front is
  const PULSE_FORCE = 3400;  // peak outward acceleration at the front
  const WARP_COOL = 26;      // frames before a wormhole will take you again

  /* ---------------------------------------------------------
     state
     --------------------------------------------------------- */
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d', { alpha: false });
  const audio = new A.AudioKit();
  const fx = new A.Particles(1400);

  const G = {
    status: 'title',        // title | flying | dead | over
    sector: 1,
    score: 0,
    mult: 1,
    hulls: 3,
    world: null,
    probe: null,
    cam: { x: 0, y: 0, zoom: 0.6, tz: 0.6 },
    mouse: { x: VW / 2, y: VH / 2, down: false, right: false },
    tether: null,
    time: 0,
    frame: 0,
    warpCool: 0,
    shake: 0,
    flash: 0,
    intro: 0,
    deadTimer: 0,
    pred: [],
    stars: [],
    started: false,
  };

  /* ---------------------------------------------------------
     sector generation
     --------------------------------------------------------- */
  function bodyMu(b) {
    if (b.type === 'beacon' || b.type === 'warp') return 0;
    if (b.type === 'pulsar') return MU_K * Math.pow(b.r * 2.1, 3);
    if (b.type === 'star') return MU_K * b.r * b.r * b.r * 2.1;
    if (b.type === 'hole') return MU_K * Math.pow(b.r * 3.6, 3);
    return MU_K * b.r * b.r * b.r;
  }

  function makeSector(depth, seedStr) {
    const rng = Rng(seedStr);
    const w = Math.min(3500, 2500 + depth * 70);
    const h = 1520;
    const start = { x: 200, y: h / 2 + rng.range(-160, 160) };
    const gate = { x: w - 210, y: h / 2 + rng.range(-420, 420), r: 46 };

    const bodies = [];
    const wants = 4 + Math.min(6, Math.floor(depth / 1.3));

    // Type mix widens with depth.
    const pool = ['planet', 'planet', 'planet'];
    if (depth >= 2) pool.push('beacon');
    if (depth >= 3) pool.push('star', 'planet');
    if (depth >= 4) pool.push('pulsar');
    if (depth >= 5) pool.push('hole');
    if (depth >= 6) pool.push('beacon', 'star', 'pulsar');

    const farFromLine = (x, y) => {
      // distance from the straight start->gate line, used to keep the
      // nastier objects off the obvious path
      const ax = start.x, ay = start.y, bx = gate.x, by = gate.y;
      const t = clamp(((x - ax) * (bx - ax) + (y - ay) * (by - ay)) /
                      ((bx - ax) ** 2 + (by - ay) ** 2), 0, 1);
      return A.dist(x, y, ax + (bx - ax) * t, ay + (by - ay) * t);
    };

    let guard = 0;
    while (bodies.length < wants && guard++ < 900) {
      const type = rng.pick(pool);
      let r;
      if (type === 'planet') r = rng.range(46, 128);
      else if (type === 'star') r = rng.range(58, 86);
      else if (type === 'hole') r = rng.range(17, 25);
      else if (type === 'pulsar') r = rng.range(20, 28);
      else r = 15; // beacon

      const x = rng.range(440, w - 430);
      const y = rng.range(150, h - 150);

      // hard caps: a sector that rolled five stars would be unplayable
      const already = bodies.filter((o) => o.type === type).length;
      if (type === 'star' && already >= 2) continue;
      if (type === 'hole' && already >= 1) continue;
      if (type === 'pulsar' && already >= 2) continue;
      if (type === 'beacon' && already >= 3) continue;

      if (A.dist(x, y, start.x, start.y) < r + 420) continue;
      if (A.dist(x, y, gate.x, gate.y) < r + 320) continue;
      // The probe launches along +x from the spawn, so keep a corridor clear;
      // otherwise sector 1 can point you straight into a planet.
      if (x > start.x && x < start.x + 1050 && Math.abs(y - start.y) < r + 300) continue;
      if (type === 'hole' && farFromLine(x, y) < 420) continue;
      if (type === 'star' && farFromLine(x, y) < 210) continue;

      let clashes = false;
      for (const o of bodies) {
        if (A.dist(x, y, o.x, o.y) < r + o.r + 230) { clashes = true; break; }
      }
      if (clashes) continue;

      const b = {
        x, y, r, type,
        hue: type === 'star' ? rng.range(28, 52)
           : type === 'hole' ? 268
           : type === 'pulsar' ? 165
           : rng.range(190, 265),
        period: type === 'pulsar' ? Math.round(rng.range(240, 420)) : 0,
        phase: type === 'pulsar' ? Math.round(rng.range(0, 400)) : 0,
        maxR: type === 'pulsar' ? rng.range(520, 780) : 0,
        seed: Math.floor(rng() * 1e9),
        spin: rng.range(-0.25, 0.25),
        grazing: false, grazeMin: 1e9,
      };
      b.mu = bodyMu(b);
      bodies.push(b);
    }

    // A wormhole pair, placed last so it can be kept clear of everything else.
    // Entering one puts you out of the other with your velocity intact, which
    // makes the short way across a sector a completely different shape.
    if (depth >= 7) {
      const spots = [];
      let tries = 0;
      while (spots.length < 2 && tries++ < 500) {
        const x = rng.range(560, w - 500), y = rng.range(180, h - 180);
        let ok = A.dist(x, y, start.x, start.y) > 500 && A.dist(x, y, gate.x, gate.y) > 420;
        for (const b of bodies) if (A.dist(x, y, b.x, b.y) < b.r + 220) ok = false;
        for (const p of spots) if (A.dist(x, y, p.x, p.y) < 900) ok = false;
        if (ok) spots.push({ x, y });
      }
      if (spots.length === 2) {
        const mk = (p) => ({ x: p.x, y: p.y, r: 34, type: 'warp', hue: 300, mu: 0,
                             seed: Math.floor(rng() * 1e9), spin: 0,
                             grazing: false, grazeMin: 1e9, period: 0, phase: 0, maxR: 0 });
        const a = mk(spots[0]), b = mk(spots[1]);
        a.link = b; b.link = a;
        bodies.push(a, b);
      }
    }

    // pickups: cores for score, cells for fuel
    const pickups = [];
    const nCores = 3 + Math.min(4, Math.floor(depth / 2));
    guard = 0;
    while (pickups.length < nCores && guard++ < 600) {
      const x = rng.range(380, w - 320), y = rng.range(110, h - 110);
      let ok = A.dist(x, y, start.x, start.y) > 260;
      for (const b of bodies) {
        // just outside a body reads as "worth the risk"
        if (A.dist(x, y, b.x, b.y) < b.r + 45) ok = false;
      }
      if (ok) pickups.push({ x, y, kind: 'core', got: false, ph: rng() * TAU });
    }
    const nFuel = 1 + (depth % 2 === 0 ? 1 : 0);
    guard = 0;
    while (pickups.filter((p) => p.kind === 'fuel').length < nFuel && guard++ < 400) {
      const x = rng.range(500, w - 400), y = rng.range(140, h - 140);
      let ok = true;
      for (const b of bodies) if (A.dist(x, y, b.x, b.y) < b.r + 60) ok = false;
      if (ok) pickups.push({ x, y, kind: 'fuel', got: false, ph: rng() * TAU });
    }

    // nebulae + starfield are baked per sector
    const neb = [];
    for (let i = 0; i < 4; i++) {
      neb.push({ x: rng.range(0, w), y: rng.range(0, h), r: rng.range(300, 720),
                 hue: rng.range(200, 300), a: rng.range(0.04, 0.11) });
    }
    const stars = [];
    for (let layer = 0; layer < 3; layer++) {
      const n = [90, 60, 34][layer];
      for (let i = 0; i < n; i++) {
        stars.push({
          x: rng() * (w + 900) - 450, y: rng() * (h + 700) - 350,
          s: [0.7, 1.1, 1.7][layer] * rng.range(0.7, 1.4),
          p: [0.25, 0.5, 0.85][layer],
          tw: rng() * TAU,
          c: rng() < 0.1 ? '#9fd0ff' : rng() < 0.16 ? '#ffd9b0' : '#ffffff',
        });
      }
    }

    return { w, h, start, gate, bodies, pickups, neb, stars, depth };
  }

  /* ---------------------------------------------------------
     physics
     --------------------------------------------------------- */
  // Shared by the live sim and the trajectory preview, so the dotted
  // line can never disagree with what actually happens.
  // `frame` lets the shock fronts be evaluated at any point in time, which is
  // what allows the trajectory preview to include them honestly.
  function accelAt(x, y, tether, out, frame) {
    let ax = 0, ay = 0;
    const fr = frame === undefined ? G.frame : frame;
    const bodies = G.world.bodies;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (b.type === 'warp') continue;            // wormholes have no field
      const dx = b.x - x, dy = b.y - y;
      const d2 = dx * dx + dy * dy + SOFT * SOFT;
      const d = Math.sqrt(d2);

      if (b.type === 'pulsar') {
        const R = (((fr + b.phase) % b.period) / b.period) * b.maxR;
        const off = Math.abs(d - R);
        if (off < PULSE_THICK && d > 1) {
          // strongest at the front itself, and weaker as the ring spreads out
          const k = (1 - off / PULSE_THICK) * PULSE_FORCE * (1 - (R / b.maxR) * 0.55);
          ax -= (dx / d) * k;
          ay -= (dy / d) * k;
        }
      }

      let mu = b.mu;
      if (b === tether) {
        if (b.type === 'beacon') {
          // beacons have no field of their own — only a hard pull when held
          const f = BEACON_PULL * clamp(600 / d, 0.35, 2.2);
          ax += (dx / d) * f; ay += (dy / d) * f;
          continue;
        }
        mu *= TETHER_MULT;
      } else if (b.type === 'beacon') {
        continue;
      }
      const f = mu / d2;
      ax += (dx / d) * f;
      ay += (dy / d) * f;
    }
    // soft wall at the sector edge — drift out and you get nudged back
    const W = G.world.w, H = G.world.h, M = 90;
    if (x < M) ax += (M - x) * 6;
    if (x > W - M) ax -= (x - (W - M)) * 6;
    if (y < M) ay += (M - y) * 6;
    if (y > H - M) ay -= (y - (H - M)) * 6;

    const mag = Math.hypot(ax, ay);
    if (mag > MAX_ACC) { ax = ax / mag * MAX_ACC; ay = ay / mag * MAX_ACC; }
    out.x = ax; out.y = ay;
  }

  const _acc = { x: 0, y: 0 };

  function predict() {
    const p = G.probe;
    if (!p || !p.alive) { G.pred.length = 0; return; }
    let x = p.x, y = p.y, vx = p.vx, vy = p.vy;
    const t = G.tether;
    const pts = G.pred;
    pts.length = 0;
    const h = DT / SUB;                    // identical to the live integrator
    const bodies = G.world.bodies;
    let frame = G.frame, cool = G.warpCool;
    outer:
    for (let i = 0; i < PRED_STEPS; i++, frame++) {
      if (cool > 0) cool--;
      for (let s = 0; s < SUB; s++) {
        accelAt(x, y, t, _acc, frame);
        vx += _acc.x * h; vy += _acc.y * h;
        const sp = Math.hypot(vx, vy);
        if (sp > MAX_SPEED) { vx = vx / sp * MAX_SPEED; vy = vy / sp * MAX_SPEED; }
        x += vx * h; y += vy * h;
        for (let k = 0; k < bodies.length; k++) {
          const b = bodies[k];
          if (b.type === 'beacon' || b.type === 'pulsar') continue;
          if (b.type === 'warp') {
            if (cool <= 0 && b.link && A.dist2(x, y, b.x, b.y) < b.r * b.r) {
              pts.push(x, y); pts.push(NaN, NaN);   // break the line at the mouth
              x = b.link.x; y = b.link.y;
              cool = WARP_COOL;
            }
            continue;
          }
          const rr = b.type === 'hole' ? b.r * 1.8 : b.r;
          if (A.dist2(x, y, b.x, b.y) < rr * rr) {
            pts.push(x, y); pts.push(NaN, NaN);
            break outer;
          }
        }
      }
      if (i % 3 === 0) pts.push(x, y);
    }
  }

  /* ---------------------------------------------------------
     run / sector lifecycle
     --------------------------------------------------------- */
  function newRun() {
    G.sector = 1; G.score = 0; G.mult = 1; G.hulls = 3;
    G.status = 'flying';
    loadSector(1, 200);
    hideAll();
    paintHud();
  }

  function loadSector(depth, entrySpeed) {
    G.world = makeSector(depth, 'od-' + depth + '-' + (Store.get('od:seed', 1) + depth * 977));
    const s = G.world.start;
    G.probe = {
      x: s.x, y: s.y,
      vx: clamp(entrySpeed, 130, 330), vy: 0,
      alive: true, fuel: G.probe ? G.probe.fuel : 100,
      trail: [], ang: 0,
    };
    G.tether = null;
    G.warpCool = 0;
    G.cam.x = s.x; G.cam.y = s.y;
    G.cam.zoom = G.cam.tz = 0.34;      // start wide, then close in
    G.intro = 1.5;
    fx.clear();
    predict();
  }

  function crash(reason) {
    if (!G.probe.alive) return;
    G.probe.alive = false;
    G.hulls--;
    G.mult = 1;
    G.shake = 26;
    G.flash = 0.9;
    G.deadTimer = 1.5;
    G.tether = null;
    fx.burst(G.probe.x, G.probe.y, 70, {
      color: '#ffd0a8', r: 3.4, drag: 0.94, glow: 16,
      spdMin: 40, spdMax: 460, lifeMin: 0.4, lifeMax: 1.4,
    });
    fx.burst(G.probe.x, G.probe.y, 26, {
      color: '#ff5470', r: 5, drag: 0.9, glow: 22,
      spdMin: 20, spdMax: 240, lifeMin: 0.5, lifeMax: 1.2,
    });
    audio.noise({ dur: 0.9, gain: 0.34, type: 'lowpass', freq: 2200, to: 60, q: 1.3 });
    audio.tone({ freq: 180, to: 40, dur: 0.9, type: 'sawtooth', gain: 0.2 });
    banner(reason, G.hulls > 0 ? `${G.hulls} hull${G.hulls === 1 ? '' : 's'} left` : 'no hulls left', true);
    paintHud();
  }

  function clearSector() {
    const bonus = 500 + G.sector * 150;
    addScore(bonus);
    G.probe.fuel = Math.min(100, G.probe.fuel + 22);
    audio.chord([392, 523, 659, 784], { dur: 0.8, type: 'triangle', gain: 0.15, spread: 0.05, send: 0.5 });
    G.flash = 0.55;
    banner('sector ' + (G.sector + 1), `+${bonus} transit bonus`);
    G.sector++;
    loadSector(G.sector, Math.hypot(G.probe.vx, G.probe.vy));
    paintHud();
  }

  function gameOver() {
    G.status = 'over';
    const best = Store.get('od:best', { score: 0, sectors: 0 });
    const isBest = G.score > best.score;
    if (isBest) Store.set('od:best', { score: G.score, sectors: G.sector });
    document.getElementById('overTitle').textContent =
      G.sector > 1 ? `Made it to sector ${G.sector}` : 'Lost in the first sector';
    document.getElementById('overStats').innerHTML =
      `<div class="stat"><div class="v ${isBest ? 'good' : ''}">${G.score.toLocaleString()}</div><div class="k">score</div></div>` +
      `<div class="stat"><div class="v">${G.sector}</div><div class="k">sectors</div></div>` +
      `<div class="stat"><div class="v">${Math.max(best.score, G.score).toLocaleString()}</div><div class="k">best</div></div>`;
    document.getElementById('overNote').textContent = isBest
      ? 'A new best. The gravity well remembers nothing, but this browser does.'
      : 'The tether is free. Speed is the expensive part.';
    show('ovOver');
  }

  function addScore(n) {
    G.score += Math.round(n);
    paintHud();
  }

  /* ---------------------------------------------------------
     step
     --------------------------------------------------------- */
  function step() {
    G.time += DT;
    G.frame++;
    fx.update(DT);
    G.shake = approach(G.shake, 0, 0.00002, DT);
    G.flash = approach(G.flash, 0, 0.0001, DT);
    if (G.intro > 0) G.intro -= DT;

    if (G.status !== 'flying') return;
    const p = G.probe;

    if (!p.alive) {
      G.deadTimer -= DT;
      if (G.deadTimer <= 0) {
        if (G.hulls <= 0) gameOver();
        else { loadSector(G.sector, 200); }
      }
      return;
    }

    /* ---- survey sweep: look before you fall ---- */
    if (G.intro > 0) {
      G.cam.zoom = approach(G.cam.zoom, 0.34, 0.06, DT);
      G.cam.x = approach(G.cam.x, G.world.w / 2, 0.0009, DT);
      G.cam.y = approach(G.cam.y, G.world.h / 2, 0.0009, DT);
      predict();
      return;
    }

    /* ---- tether selection ---- */
    const mw = screenToWorld(G.mouse.x, G.mouse.y);
    if (G.mouse.down) {
      if (!G.tether) {
        let best = null, bestD = 1e9;
        for (const b of G.world.bodies) {
          if (b.type === 'hole' || b.type === 'warp') continue;  // neither can be held
          const d = A.dist(mw.x, mw.y, b.x, b.y) - b.r;
          if (d < bestD) { bestD = d; best = b; }
        }
        if (best && bestD < 480) {
          G.tether = best;
          audio.tone({ freq: 300, to: 620, dur: 0.16, type: 'sawtooth', gain: 0.09 });
        }
      }
    } else if (G.tether) {
      audio.tone({ freq: 620, to: 260, dur: 0.14, type: 'sawtooth', gain: 0.07 });
      G.tether = null;
    }

    /* ---- burn ---- */
    let burning = false;
    if (G.mouse.right && p.fuel > 0) {
      const dx = mw.x - p.x, dy = mw.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      p.vx += (dx / d) * BURN_ACC * DT;
      p.vy += (dy / d) * BURN_ACC * DT;
      p.fuel = Math.max(0, p.fuel - BURN_COST * DT);
      burning = true;
      if (Math.random() < 0.7) {
        fx.spawn({
          x: p.x - (dx / d) * 8, y: p.y - (dy / d) * 8,
          vx: -(dx / d) * 160 + (Math.random() - 0.5) * 60,
          vy: -(dy / d) * 160 + (Math.random() - 0.5) * 60,
          life: 0.32, max: 0.32, r: 2.6, color: '#ffb070', glow: 10, drag: 0.9,
        });
      }
    }

    /* ---- integrate ---- */
    const h = DT / SUB;
    for (let s = 0; s < SUB; s++) {
      accelAt(p.x, p.y, G.tether, _acc);
      p.vx += _acc.x * h; p.vy += _acc.y * h;
      const sp = Math.hypot(p.vx, p.vy);
      if (sp > MAX_SPEED) { p.vx = p.vx / sp * MAX_SPEED; p.vy = p.vy / sp * MAX_SPEED; }
      p.x += p.vx * h; p.y += p.vy * h;

      /* ---- contact ---- */
      if (G.warpCool > 0) G.warpCool--;
      for (const b of G.world.bodies) {
        if (b.type === 'beacon') continue;
        if (b.type === 'warp') {
          if (G.warpCool <= 0 && b.link && A.dist2(p.x, p.y, b.x, b.y) < b.r * b.r) {
            fx.burst(p.x, p.y, 26, { color: '#e0a8ff', r: 3, drag: 0.9, glow: 16,
              spdMin: 40, spdMax: 240, lifeMin: 0.3, lifeMax: 0.8 });
            p.x = b.link.x; p.y = b.link.y;
            p.trail.length = 0;
            G.warpCool = WARP_COOL;
            G.flash = 0.4;
            fx.burst(p.x, p.y, 26, { color: '#e0a8ff', r: 3, drag: 0.9, glow: 16,
              spdMin: 40, spdMax: 240, lifeMin: 0.3, lifeMax: 0.8 });
            audio.tone({ freq: 240, to: 1100, dur: 0.28, type: 'sine', gain: 0.16, send: 0.6 });
            audio.noise({ dur: 0.3, gain: 0.1, type: 'bandpass', freq: 400, to: 3000, q: 2 });
          }
          continue;
        }
        const d = A.dist(p.x, p.y, b.x, b.y);
        if (b.type === 'hole') {
          if (d < b.r * 1.8) { crash('consumed'); return; }
          continue;
        }
        if (d < b.r) {
          const speed = Math.hypot(p.vx, p.vy);
          if (speed > CRASH_SPEED) { crash('hull breached'); return; }
          // survivable: push out and bounce softly
          const nx = (p.x - b.x) / (d || 1), ny = (p.y - b.y) / (d || 1);
          p.x = b.x + nx * (b.r + 0.5); p.y = b.y + ny * (b.r + 0.5);
          const dot = p.vx * nx + p.vy * ny;
          p.vx = (p.vx - 2 * dot * nx) * 0.45;
          p.vy = (p.vy - 2 * dot * ny) * 0.45;
          audio.noise({ dur: 0.16, gain: 0.13, type: 'lowpass', freq: 700, to: 140 });
          G.shake = 7;
        }
        if (b.type === 'star' && d < b.r * 2.05) {
          // corona: survivable but it eats the hull's margin fast
          if (Math.random() < 0.5) {
            fx.spawn({ x: p.x, y: p.y, vx: (Math.random() - 0.5) * 90, vy: (Math.random() - 0.5) * 90,
                       life: 0.3, max: 0.3, r: 2.4, color: '#ffdca0', glow: 12, drag: 0.9 });
          }
          if (d < b.r * 1.35) { crash('burned up'); return; }
        }
      }
    }

    p.ang = Math.atan2(p.vy, p.vx);
    p.trail.unshift({ x: p.x, y: p.y });
    if (p.trail.length > 46) p.trail.pop();

    /* ---- grazes build the multiplier ---- */
    const speed = Math.hypot(p.vx, p.vy);
    for (const b of G.world.bodies) {
      if (b.type === 'beacon' || b.type === 'warp') continue;
      const d = A.dist(p.x, p.y, b.x, b.y);
      if (d < b.r * GRAZE_IN && speed > 190) {
        b.grazing = true;
        b.grazeMin = Math.min(b.grazeMin, d / b.r);
      } else if (b.grazing && d > b.r * GRAZE_OUT) {
        b.grazing = false;
        const tight = clamp((GRAZE_IN - b.grazeMin) / (GRAZE_IN - 1), 0, 1);
        const pts = (40 + tight * 160) * G.mult;
        addScore(pts);
        G.mult = Math.min(9.9, G.mult + 0.25 + tight * 0.45);
        b.grazeMin = 1e9;
        banner('slingshot', `+${Math.round(pts)}  ×${G.mult.toFixed(1)}`);
        audio.tone({ freq: 480 + tight * 300, to: 900, dur: 0.2, type: 'triangle', gain: 0.11, send: 0.4 });
        audio.noise({ dur: 0.4, gain: 0.09, type: 'bandpass', freq: 900, to: 2400, q: 2 });
      }
    }
    // the multiplier bleeds away if you play it safe
    G.mult = Math.max(1, G.mult - 0.16 * DT);

    /* ---- pickups ---- */
    for (const q of G.world.pickups) {
      if (q.got) continue;
      if (A.dist2(p.x, p.y, q.x, q.y) < 26 * 26) {
        q.got = true;
        if (q.kind === 'core') {
          const pts = 220 * G.mult;
          addScore(pts);
          audio.tone({ freq: 880, dur: 0.28, type: 'triangle', gain: 0.16, send: 0.5 });
          audio.tone({ freq: 1320, dur: 0.2, type: 'sine', gain: 0.09, delay: 0.03 });
          fx.burst(q.x, q.y, 22, { color: '#9ad4ff', r: 3, drag: 0.9, glow: 14,
                                   spdMin: 30, spdMax: 200, lifeMin: 0.3, lifeMax: 0.8 });
        } else {
          p.fuel = Math.min(100, p.fuel + 34);
          audio.tone({ freq: 300, to: 560, dur: 0.3, type: 'square', gain: 0.11 });
          fx.burst(q.x, q.y, 18, { color: '#6cf0b4', r: 3, drag: 0.9, glow: 14,
                                   spdMin: 30, spdMax: 170, lifeMin: 0.3, lifeMax: 0.7 });
        }
      }
    }

    /* ---- gate ---- */
    const gt = G.world.gate;
    if (A.dist2(p.x, p.y, gt.x, gt.y) < (gt.r + 6) * (gt.r + 6)) { clearSector(); return; }

    /* ---- camera ---- */
    const lead = 0.34;
    G.cam.tz = clamp(0.66 - (speed - 190) / 2900, 0.40, 0.70);
    G.cam.zoom = approach(G.cam.zoom, G.cam.tz, 0.06, DT);
    const camTargetX = p.x + p.vx * lead;
    const camTargetY = p.y + p.vy * lead;
    G.cam.x = approach(G.cam.x, camTargetX, 0.0009, DT);
    G.cam.y = approach(G.cam.y, camTargetY, 0.0009, DT);

    predict();
    if ((G.gaugeTick = (G.gaugeTick | 0) + 1) % 4 === 0) paintGauges(speed, p.fuel);
  }

  /* ---------------------------------------------------------
     camera helpers
     --------------------------------------------------------- */
  const worldToScreen = (x, y) => ({
    x: (x - G.cam.x) * G.cam.zoom + VW / 2,
    y: (y - G.cam.y) * G.cam.zoom + VH / 2,
  });
  const screenToWorld = (x, y) => ({
    x: (x - VW / 2) / G.cam.zoom + G.cam.x,
    y: (y - VH / 2) / G.cam.zoom + G.cam.y,
  });

  /* ---------------------------------------------------------
     render
     --------------------------------------------------------- */
  function render() {
    const t = G.time;
    ctx.fillStyle = '#03040a';
    ctx.fillRect(0, 0, VW, VH);
    if (!G.world) return;

    ctx.save();
    if (G.shake > 0.3) ctx.translate((Math.random() - 0.5) * G.shake, (Math.random() - 0.5) * G.shake);

    const W = G.world, z = G.cam.zoom;

    /* ---- nebulae ---- */
    for (const n of W.neb) {
      const s = worldToScreen(n.x, n.y);
      const r = n.r * z;
      if (s.x + r < 0 || s.x - r > VW || s.y + r < 0 || s.y - r > VH) continue;
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
      g.addColorStop(0, `hsla(${n.hue},70%,60%,${n.a})`);
      g.addColorStop(1, `hsla(${n.hue},70%,50%,0)`);
      ctx.fillStyle = g;
      ctx.fillRect(s.x - r, s.y - r, r * 2, r * 2);
    }

    /* ---- parallax stars ---- */
    for (const st of W.stars) {
      const sx = (st.x - G.cam.x * st.p) * z + VW / 2;
      const sy = (st.y - G.cam.y * st.p) * z + VH / 2;
      if (sx < -6 || sx > VW + 6 || sy < -6 || sy > VH + 6) continue;
      ctx.globalAlpha = 0.32 + Math.abs(Math.sin(t * 0.9 + st.tw)) * 0.55;
      ctx.fillStyle = st.c;
      ctx.fillRect(sx, sy, st.s, st.s);
    }
    ctx.globalAlpha = 1;

    /* ---- sector boundary ---- */
    const tl = worldToScreen(0, 0), br = worldToScreen(W.w, W.h);
    ctx.strokeStyle = 'rgba(127,178,255,0.10)';
    ctx.lineWidth = 1;
    ctx.setLineDash([9, 11]);
    ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    ctx.setLineDash([]);

    /* ---- gate ---- */
    drawGate(W.gate, t, z);

    /* ---- pickups ---- */
    for (const q of W.pickups) {
      if (q.got) continue;
      const s = worldToScreen(q.x, q.y);
      if (s.x < -40 || s.x > VW + 40 || s.y < -40 || s.y > VH + 40) continue;
      const bob = Math.sin(t * 2.4 + q.ph) * 3;
      ctx.save();
      ctx.translate(s.x, s.y + bob);
      if (q.kind === 'core') {
        ctx.rotate(t * 1.4 + q.ph);
        ctx.shadowBlur = 16; ctx.shadowColor = '#9ad4ff';
        ctx.fillStyle = '#9ad4ff';
        ctx.beginPath();
        ctx.moveTo(0, -7 * z * 1.6); ctx.lineTo(6 * z * 1.6, 0);
        ctx.lineTo(0, 7 * z * 1.6); ctx.lineTo(-6 * z * 1.6, 0);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#eaf6ff';
        ctx.beginPath(); ctx.arc(0, 0, 2 * z * 1.6, 0, TAU); ctx.fill();
      } else {
        ctx.shadowBlur = 14; ctx.shadowColor = '#6cf0b4';
        ctx.fillStyle = '#6cf0b4';
        const w2 = 5 * z * 1.7, h2 = 8 * z * 1.7;
        A.roundRect(ctx, -w2, -h2, w2 * 2, h2 * 2, 2.5); ctx.fill();
        ctx.fillStyle = '#04140d';
        ctx.fillRect(-w2 * 0.5, -h2 * 0.35, w2, h2 * 0.7);
      }
      ctx.restore();
    }

    /* ---- bodies ---- */
    for (const b of W.bodies) drawBody(b, t, z);

    /* ---- trajectory ---- */
    if (G.probe && G.probe.alive && G.pred.length > 2) {
      ctx.save();
      for (let i = 0; i < G.pred.length; i += 2) {
        const px = G.pred[i], py = G.pred[i + 1];
        if (isNaN(px)) break;
        const s = worldToScreen(px, py);
        const k = i / G.pred.length;
        ctx.globalAlpha = (1 - k) * 0.62;
        ctx.fillStyle = G.tether ? '#ffd08a' : '#7fb2ff';
        const r = lerp(2.1, 0.7, k);
        ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, TAU); ctx.fill();
      }
      // mark the predicted impact point, if there is one
      const last = G.pred.length;
      if (isNaN(G.pred[last - 2])) {
        const ix = G.pred[last - 4], iy = G.pred[last - 3];
        const s = worldToScreen(ix, iy);
        ctx.globalAlpha = 0.8 + Math.sin(t * 12) * 0.2;
        ctx.strokeStyle = '#ff5470';
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(s.x, s.y, 8, 0, TAU); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(s.x - 11, s.y); ctx.lineTo(s.x + 11, s.y);
        ctx.moveTo(s.x, s.y - 11); ctx.lineTo(s.x, s.y + 11); ctx.stroke();
      }
      ctx.restore();
    }

    /* ---- tether beam ---- */
    if (G.tether && G.probe && G.probe.alive) {
      const a = worldToScreen(G.probe.x, G.probe.y);
      const b = worldToScreen(G.tether.x, G.tether.y);
      ctx.save();
      ctx.strokeStyle = 'rgba(255,208,138,0.75)';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([7, 7]);
      ctx.lineDashOffset = -t * 90;
      ctx.shadowBlur = 12; ctx.shadowColor = '#ffd08a';
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.setLineDash([]);
      // energy pips running down the beam
      for (let i = 0; i < 5; i++) {
        const k = ((t * 0.85 + i / 5) % 1);
        const px = lerp(a.x, b.x, k), py = lerp(a.y, b.y, k);
        ctx.globalAlpha = Math.sin(k * Math.PI);
        ctx.fillStyle = '#ffeccd';
        ctx.beginPath(); ctx.arc(px, py, 2.2, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }

    /* ---- probe ---- */
    const p = G.probe;
    if (p && p.alive) {
      // trail
      ctx.save();
      for (let i = p.trail.length - 1; i > 0; i--) {
        const s1 = worldToScreen(p.trail[i].x, p.trail[i].y);
        const s2 = worldToScreen(p.trail[i - 1].x, p.trail[i - 1].y);
        ctx.globalAlpha = (1 - i / p.trail.length) * 0.5;
        ctx.strokeStyle = G.tether ? '#ffd08a' : '#7fb2ff';
        ctx.lineWidth = lerp(0.5, 2.4, 1 - i / p.trail.length);
        ctx.beginPath(); ctx.moveTo(s1.x, s1.y); ctx.lineTo(s2.x, s2.y); ctx.stroke();
      }
      ctx.restore();

      const s = worldToScreen(p.x, p.y);
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(p.ang);
      ctx.shadowBlur = 16; ctx.shadowColor = '#cfe4ff';
      ctx.fillStyle = '#eaf3ff';
      ctx.beginPath();
      ctx.moveTo(9, 0); ctx.lineTo(-6, 5.5); ctx.lineTo(-3, 0); ctx.lineTo(-6, -5.5);
      ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#7fb2ff';
      ctx.beginPath(); ctx.arc(1, 0, 2, 0, TAU); ctx.fill();
      ctx.restore();
    }

    fx.draw(ctx);

    /* ---- gate compass ---- */
    if (p && p.alive) drawCompass(W.gate, p);

    ctx.restore();

    /* ---- intro sweep label ---- */
    if (G.intro > 0) {
      ctx.save();
      ctx.globalAlpha = clamp(G.intro / 1.5, 0, 1) * 0.9;
      ctx.fillStyle = '#cfe4ff';
      ctx.font = '600 13px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.letterSpacing = '4px';
      ctx.fillText('SECTOR ' + G.sector, VW / 2, 60);
      ctx.globalAlpha *= 0.75;
      ctx.font = '500 10px ui-monospace, monospace';
      ctx.fillText('READ THE FIELD', VW / 2, 80);
      ctx.restore();
    }

    if (G.flash > 0.01) {
      ctx.globalAlpha = G.flash * 0.55;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, VW, VH);
      ctx.globalAlpha = 1;
    }

    // vignette
    const vg = ctx.createRadialGradient(VW / 2, VH / 2, VH * 0.34, VW / 2, VH / 2, VH * 0.95);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, VW, VH);
  }

  function drawBody(b, t, z) {
    const s = worldToScreen(b.x, b.y);
    const r = b.r * z;
    if (s.x + r * 3 < 0 || s.x - r * 3 > VW || s.y + r * 3 < 0 || s.y - r * 3 > VH) return;

    if (b.type === 'beacon') {
      const held = G.tether === b;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(t * 0.8);
      ctx.shadowBlur = held ? 26 : 12;
      ctx.shadowColor = '#c88aff';
      ctx.strokeStyle = held ? '#e8c9ff' : '#c88aff';
      ctx.lineWidth = 2;
      const k = r * (held ? 1.5 : 1.1) * (1 + Math.sin(t * 3) * 0.08);
      ctx.beginPath();
      ctx.moveTo(0, -k); ctx.lineTo(k, 0); ctx.lineTo(0, k); ctx.lineTo(-k, 0);
      ctx.closePath(); ctx.stroke();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#c88aff';
      ctx.fill();
      ctx.restore();
      // reach ring
      ctx.save();
      ctx.globalAlpha = 0.10 + (held ? 0.16 : 0);
      ctx.strokeStyle = '#c88aff';
      ctx.setLineDash([3, 7]);
      ctx.beginPath(); ctx.arc(s.x, s.y, 600 * z, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      return;
    }

    if (b.type === 'warp') {
      ctx.save();
      // a soft mouth with counter-rotating arcs
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * 2.2);
      g.addColorStop(0, 'rgba(224,168,255,0.55)');
      g.addColorStop(0.45, 'rgba(160,90,240,0.20)');
      g.addColorStop(1, 'rgba(120,50,200,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(s.x, s.y, r * 2.2, 0, TAU); ctx.fill();
      for (let i = 0; i < 4; i++) {
        ctx.globalAlpha = 0.85 - i * 0.16;
        ctx.strokeStyle = '#e0a8ff';
        ctx.lineWidth = 1.6;
        const rr = r * (0.35 + i * 0.22);
        const a0 = t * (2.2 - i * 0.4) * (i % 2 ? -1 : 1) + i;
        ctx.beginPath(); ctx.arc(s.x, s.y, rr, a0, a0 + TAU * 0.55); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(20,4,36,0.85)';
      ctx.beginPath(); ctx.arc(s.x, s.y, r * 0.32, 0, TAU); ctx.fill();
      // a hint of where it comes out
      if (b.link) {
        const l = worldToScreen(b.link.x, b.link.y);
        ctx.globalAlpha = 0.13;
        ctx.strokeStyle = '#e0a8ff';
        ctx.setLineDash([2, 14]);
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(l.x, l.y); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
      return;
    }

    if (b.type === 'pulsar') {
      ctx.save();
      const phase = ((t * 60 + b.phase) % b.period) / b.period;
      // the live shock front, plus a ghost of the one behind it
      for (const k of [0, 1]) {
        const ph = phase - k;
        if (ph < 0) continue;
        const R = ph * b.maxR * z;
        const fade = 1 - ph;
        ctx.globalAlpha = fade * 0.75;
        ctx.strokeStyle = '#7dffd4';
        ctx.lineWidth = 2.4 * fade + 0.6;
        ctx.shadowBlur = 18 * fade; ctx.shadowColor = '#7dffd4';
        ctx.beginPath(); ctx.arc(s.x, s.y, R, 0, TAU); ctx.stroke();
        ctx.globalAlpha = fade * 0.10;
        ctx.lineWidth = PULSE_THICK * z;
        ctx.beginPath(); ctx.arc(s.x, s.y, R, 0, TAU); ctx.stroke();
      }
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
      // core
      const cg = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * 2.4);
      cg.addColorStop(0, '#e6fff6');
      cg.addColorStop(0.3, '#7dffd4');
      cg.addColorStop(1, 'rgba(60,220,180,0)');
      ctx.fillStyle = cg;
      ctx.beginPath(); ctx.arc(s.x, s.y, r * 2.4, 0, TAU); ctx.fill();
      ctx.fillStyle = '#f2fffa';
      ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, TAU); ctx.fill();
      // sweeping beams, because it is a lighthouse
      ctx.globalAlpha = 0.30;
      ctx.strokeStyle = '#7dffd4';
      ctx.lineWidth = 2;
      for (let i = 0; i < 2; i++) {
        const a = t * 1.7 + i * Math.PI;
        ctx.beginPath();
        ctx.moveTo(s.x + Math.cos(a) * r, s.y + Math.sin(a) * r);
        ctx.lineTo(s.x + Math.cos(a) * r * 6, s.y + Math.sin(a) * r * 6);
        ctx.stroke();
      }
      ctx.restore();
      return;
    }

    if (b.type === 'hole') {
      ctx.save();
      // accretion glow
      const g = ctx.createRadialGradient(s.x, s.y, r * 0.9, s.x, s.y, r * 5.5);
      g.addColorStop(0, 'rgba(190,110,255,0.42)');
      g.addColorStop(0.35, 'rgba(120,60,220,0.14)');
      g.addColorStop(1, 'rgba(60,20,120,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(s.x, s.y, r * 5.5, 0, TAU); ctx.fill();
      // swirling arcs
      for (let i = 0; i < 3; i++) {
        ctx.globalAlpha = 0.5 - i * 0.13;
        ctx.strokeStyle = '#d5a8ff';
        ctx.lineWidth = 1.4;
        const rr = r * (2.1 + i * 0.75);
        const a0 = t * (1.4 - i * 0.3) + i;
        ctx.beginPath(); ctx.arc(s.x, s.y, rr, a0, a0 + 2.1); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // horizon
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.arc(s.x, s.y, r * 1.8, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(220,170,255,0.85)';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(s.x, s.y, r * 1.8, 0, TAU); ctx.stroke();
      ctx.restore();
      return;
    }

    const held = G.tether === b;
    const isStar = b.type === 'star';

    if (isStar) {
      const g = ctx.createRadialGradient(s.x, s.y, r * 0.7, s.x, s.y, r * 2.15);
      g.addColorStop(0, `hsla(${b.hue},100%,66%,0.55)`);
      g.addColorStop(0.5, `hsla(${b.hue},100%,58%,0.18)`);
      g.addColorStop(1, `hsla(${b.hue},100%,50%,0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(s.x, s.y, r * 2.15, 0, TAU); ctx.fill();
      // corona edge — the line you must not cross
      ctx.strokeStyle = `hsla(${b.hue},100%,70%,${0.22 + Math.sin(t * 3) * 0.07})`;
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 6]);
      ctx.beginPath(); ctx.arc(s.x, s.y, r * 1.35, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
    } else {
      // atmosphere
      const g = ctx.createRadialGradient(s.x, s.y, r, s.x, s.y, r * 1.45);
      g.addColorStop(0, `hsla(${b.hue},80%,65%,0.28)`);
      g.addColorStop(1, `hsla(${b.hue},80%,60%,0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(s.x, s.y, r * 1.45, 0, TAU); ctx.fill();
    }

    // globe
    const lx = s.x - r * 0.34, ly = s.y - r * 0.36;
    const pg = ctx.createRadialGradient(lx, ly, r * 0.08, s.x, s.y, r);
    if (isStar) {
      pg.addColorStop(0, `hsl(${b.hue},100%,88%)`);
      pg.addColorStop(0.55, `hsl(${b.hue},100%,64%)`);
      pg.addColorStop(1, `hsl(${b.hue - 12},95%,44%)`);
    } else {
      pg.addColorStop(0, `hsl(${b.hue},62%,64%)`);
      pg.addColorStop(0.62, `hsl(${b.hue},52%,37%)`);
      pg.addColorStop(1, `hsl(${b.hue + 12},48%,13%)`);
    }
    ctx.fillStyle = pg;
    ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, TAU); ctx.fill();

    // surface detail
    if (!isStar && r > 14) {
      const rng = Rng(b.seed);
      ctx.save();
      ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, TAU); ctx.clip();
      ctx.globalAlpha = 0.16;
      for (let i = 0; i < 7; i++) {
        const bx = s.x + (rng() - 0.5) * r * 1.9;
        const by = s.y + (rng() - 0.5) * r * 1.9;
        const br = r * rng.range(0.14, 0.42);
        ctx.fillStyle = rng() < 0.5 ? '#000' : '#fff';
        ctx.beginPath(); ctx.arc(bx, by, br, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }

    // held highlight
    if (held) {
      ctx.save();
      ctx.strokeStyle = '#ffd08a';
      ctx.lineWidth = 2;
      ctx.shadowBlur = 20; ctx.shadowColor = '#ffd08a';
      ctx.globalAlpha = 0.85;
      ctx.beginPath(); ctx.arc(s.x, s.y, r + 6, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 0.28;
      ctx.setLineDash([4, 8]);
      ctx.lineDashOffset = -t * 40;
      ctx.beginPath(); ctx.arc(s.x, s.y, r + 15, 0, TAU); ctx.stroke();
      ctx.restore();
    }
  }

  function drawGate(g, t, z) {
    const s = worldToScreen(g.x, g.y);
    const r = g.r * z;
    ctx.save();
    ctx.translate(s.x, s.y);
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.4);
    glow.addColorStop(0, 'rgba(108,240,180,0.30)');
    glow.addColorStop(1, 'rgba(108,240,180,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(0, 0, r * 2.4, 0, TAU); ctx.fill();
    for (let i = 0; i < 4; i++) {
      const rr = r * (0.45 + i * 0.2);
      const a0 = t * (1.5 - i * 0.32) * (i % 2 ? -1 : 1);
      ctx.strokeStyle = `rgba(108,240,180,${0.9 - i * 0.16})`;
      ctx.lineWidth = 2;
      ctx.shadowBlur = 14; ctx.shadowColor = '#6cf0b4';
      ctx.beginPath(); ctx.arc(0, 0, rr, a0, a0 + TAU * 0.62); ctx.stroke();
    }
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  function drawCompass(g, p) {
    const s = worldToScreen(g.x, g.y);
    const m = 34;
    if (s.x > m && s.x < VW - m && s.y > m && s.y < VH - m) return; // gate is on screen
    const ang = Math.atan2(g.y - p.y, g.x - p.x);
    const cx = VW / 2, cy = VH / 2;
    const rx = VW / 2 - m, ry = VH / 2 - m;
    const k = Math.min(rx / Math.abs(Math.cos(ang) || 1e-6), ry / Math.abs(Math.sin(ang) || 1e-6));
    const ax = cx + Math.cos(ang) * k, ay = cy + Math.sin(ang) * k;
    const d = Math.round(A.dist(p.x, p.y, g.x, g.y));
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(ang);
    ctx.fillStyle = '#6cf0b4';
    ctx.shadowBlur = 12; ctx.shadowColor = '#6cf0b4';
    ctx.beginPath();
    ctx.moveTo(11, 0); ctx.lineTo(-6, 6); ctx.lineTo(-6, -6);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.fillStyle = 'rgba(108,240,180,0.75)';
    ctx.font = '600 9px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(d + 'm', ax, ay + (ay > VH / 2 ? -14 : 20));
    ctx.restore();
  }

  /* ---------------------------------------------------------
     HUD
     --------------------------------------------------------- */
  const $ = (id) => document.getElementById(id);
  let bannerTimer = 0;

  function banner(big, sub, bad) {
    const el = $('banner');
    el.innerHTML = `<div class="big">${big}</div><div class="sub">${sub || ''}</div>`;
    el.classList.toggle('bad', !!bad);
    el.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => el.classList.remove('show'), 1400);
  }

  function paintHud() {
    $('hSector').textContent = G.sector;
    $('hScore').textContent = G.score.toLocaleString();
    const m = $('hMult');
    m.textContent = '×' + G.mult.toFixed(1);
    m.classList.toggle('hot', G.mult >= 3);
    const hulls = $('hHulls');
    hulls.innerHTML = '';
    for (let i = 0; i < 3; i++) {
      const d = document.createElement('div');
      d.className = 'hull-pip' + (i < G.hulls ? '' : ' gone');
      hulls.appendChild(d);
    }
  }

  function paintGauges(speed, fuel) {
    const f = $('hFuel');
    f.style.width = fuel + '%';
    f.className = fuel < 15 ? 'crit' : fuel < 35 ? 'low' : '';
    const s = $('hSpd');
    const pct = clamp(speed / MAX_SPEED, 0, 1) * 100;
    s.style.width = pct + '%';
    s.className = speed > 620 ? 'danger' : speed > 380 ? 'fast' : '';
    $('hSpdNum').textContent = Math.round(speed);
    const m = $('hMult');
    m.textContent = '×' + G.mult.toFixed(1);
    m.classList.toggle('hot', G.mult >= 3);
  }

  /* ---------------------------------------------------------
     overlays + input
     --------------------------------------------------------- */
  const OVER = ['ovHelp', 'ovOver', 'ovStart'];
  const show = (id) => OVER.forEach((o) => { $(o).hidden = o !== id; });
  const hideAll = () => OVER.forEach((o) => { $(o).hidden = true; });
  const anyOverlay = () => OVER.some((o) => !$(o).hidden);

  function mouseTo(e) {
    const r = canvas.getBoundingClientRect();
    G.mouse.x = (e.clientX - r.left) / r.width * VW;
    G.mouse.y = (e.clientY - r.top) / r.height * VH;
  }
  canvas.addEventListener('pointermove', mouseTo);
  canvas.addEventListener('pointerdown', (e) => {
    audio.unlock();
    mouseTo(e);
    if (e.button === 0) G.mouse.down = true;
    if (e.button === 2) G.mouse.right = true;
    canvas.setPointerCapture(e.pointerId);
  });
  window.addEventListener('pointerup', (e) => {
    if (e.button === 0) G.mouse.down = false;
    if (e.button === 2) G.mouse.right = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('blur', () => { G.mouse.down = false; G.mouse.right = false; });

  window.addEventListener('keydown', (e) => {
    if (e.key === ' ') { G.mouse.right = true; e.preventDefault(); }
    if (e.key === 'r' || e.key === 'R') {
      if (G.status === 'flying' && G.probe && G.probe.alive) crash('scuttled');
    }
    if (e.key === 'Escape' && anyOverlay() && G.started && G.status === 'flying') hideAll();
  });
  window.addEventListener('keyup', (e) => { if (e.key === ' ') G.mouse.right = false; });

  A.mountChrome(audio);
  $('startBtn').addEventListener('click', () => {
    audio.unlock(); audio.setReverb(0.22);
    G.started = true;
    Store.set('od:seed', Math.floor(Math.random() * 1e6));
    newRun();
  });
  $('helpBtn').addEventListener('click', () => show('ovHelp'));
  $('closeHelp').addEventListener('click', () => { if (G.started) hideAll(); else show('ovStart'); });
  $('againBtn').addEventListener('click', () => {
    Store.set('od:seed', Math.floor(Math.random() * 1e6));
    newRun();
  });

  /* ---------------------------------------------------------
     loop
     --------------------------------------------------------- */
  const loop = A.Loop({ hz: HZ, step, render });
  ctx.fillStyle = '#03040a';
  ctx.fillRect(0, 0, VW, VH);
  show('ovStart');
  loop.start();

  // debug hook (rAF is paused while the tab is hidden)
  window.__OD = {
    G, makeSector, accelAt, predict,
    tick(n = 1) { for (let i = 0; i < n; i++) step(); },
    paint() { render(); },
    newRun, loadSector,
    probe() { const p = G.probe; return p && { x: +p.x.toFixed(1), y: +p.y.toFixed(1),
      vx: +p.vx.toFixed(1), vy: +p.vy.toFixed(1), speed: +Math.hypot(p.vx, p.vy).toFixed(1),
      fuel: +p.fuel.toFixed(1), alive: p.alive }; },
    state() { return { status: G.status, sector: G.sector, score: G.score,
      mult: +G.mult.toFixed(2), hulls: G.hulls, tether: G.tether && G.tether.type,
      bodies: G.world && G.world.bodies.length, pickups: G.world && G.world.pickups.length }; },
  };
})();
