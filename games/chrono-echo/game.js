/* ============================================================
   CHRONO ECHO
   A time-loop puzzle platformer.

   Core idea: each loop you record a "take". Every take you have
   already made replays alongside you as a SOLID body. Echoes are
   replayed by position (not by input), which makes the whole
   simulation trivially deterministic — no paradoxes, no drift.
   ============================================================ */
(function () {
  'use strict';

  const A = window.Arcade;
  const { clamp, lerp, approach, TAU, Store, Rng } = A;

  /* ---------------------------------------------------------
     1. constants
     --------------------------------------------------------- */
  const COLS = 32, ROWS = 18, TILE = 30;
  const VW = COLS * TILE;              // 960
  const VH = ROWS * TILE;              // 540
  const HZ = 60, DT = 1 / HZ;
  const LOOP_SECONDS = 14;
  const MAXF = LOOP_SECONDS * HZ;      // 840 frames per take

  // Player body + movement. Tuned so that a 2-tile hop is comfortable,
  // a 3-tile ledge is impossible alone but reachable from an echo's head,
  // and a 4-tile ledge needs two stacked echoes.
  const PW = 18, PH = 28;
  const GRAV = 1750, MAXFALL = 780;
  const RUN = 185, ACC_G = 1900, ACC_A = 1250, FRIC_G = 2400, FRIC_A = 420;
  const JUMP = 536, CUT = 0.42;
  const COYOTE = 6, BUFFER = 8;        // frames

  const ECHO_COLORS = ['#b06bff', '#ff6bd6', '#6b9dff', '#ff9a6b', '#8cff7a', '#ff6b6b'];
  const PLAYER_COLOR = '#5df2d6';

  // tile codes
  const T_EMPTY = 0, T_SOLID = 1, T_ONEWAY = 2, T_SPIKE = 3;

  /* ---------------------------------------------------------
     2. levels

     legend:
       #  solid          =  one-way platform      ^  spike
       S  spawn          X  exit                  o  orb
       1 2 3  pressure plates (flat pads, not solid)
       a b c  gates, opened by plate 1 / 2 / 3
     --------------------------------------------------------- */
  const LEVELS = [
    {
      name: 'First Light',
      hint: 'Climb. Take the orb. Step into the gate.',
      loops: 3, par: 1,
      rows: [
        '################################',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#.........................o....#',
        '#......................#########',
        '#..............................#',
        '#...............########.......#',
        '#..............................#',
        '#.........######...............#',
        '#..............................#',
        '#...####.......................#',
        '#..S.....................X.....#',
        '################################',
        '################################',
        '################################',
      ],
    },
    {
      name: 'Dead Weight',
      hint: 'The gate holds open only while something rests on the pad.',
      loops: 3, par: 2,
      rows: [
        '################################',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#.................#............#',
        '#.................#............#',
        '#.................#............#',
        '#.................#............#',
        '#..S........1.....a......X.....#',
        '################################',
        '################################',
        '################################',
      ],
    },
    {
      name: 'Leg Up',
      hint: 'That shelf is one jump too high. Fortunately you have shoulders.',
      loops: 3, par: 2,
      rows: [
        '################################',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..........................X...#',
        '#.....................##########',
        '#..............................#',
        '#..S...........................#',
        '################################',
        '################################',
        '################################',
      ],
    },
    {
      name: 'Scattered',
      hint: 'Three pits you cannot climb out of. Orbs stay collected.',
      loops: 5, par: 4,
      rows: [
        '################################',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#S.......................X.....#',
        '#####..#####..#####..###########',
        '#####..#####..#####..###########',
        '#####o.#####o.#####o.###########',
        '################################',
        '################################',
        '################################',
      ],
    },
    {
      name: 'Stairwell',
      hint: 'Four tiles of nothing. Build a staircase out of yourself.',
      loops: 4, par: 3,
      rows: [
        '################################',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#....................o....X....#',
        '#..................#############',
        '#..................#############',
        '#..................#############',
        '#..S...............#############',
        '################################',
        '################################',
        '################################',
      ],
    },
    {
      name: 'Crossfire',
      hint: 'Three beams, all keeping time. So can you.',
      loops: 3, par: 1,
      rows: [
        '################################',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#........................o.....#',
        '#......................#########',
        '#..............................#',
        '#............#########.........#',
        '#..............................#',
        '#.....######...................#',
        '#..S.....................X.....#',
        '################################',
        '################################',
        '################################',
      ],
      lasers: [
        { x: 1, y: 14, dir: 'r', period: 150, on: 50, phase: 60 },
        { x: 1, y: 12, dir: 'r', period: 150, on: 50, phase: 110 },
        { x: 1, y: 10, dir: 'r', period: 150, on: 50, phase: 10 },
      ],
    },
    {
      name: 'Double Bind',
      hint: 'Two pads, held at once. You are exactly one body short.',
      loops: 4, par: 3,
      rows: [
        '################################',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#.................##...........#',
        '#.................##...........#',
        '#.................##...........#',
        '#.................ab...........#',
        '#.................ab...........#',
        '#.................ab...........#',
        '#..S.....1....2...ab.....X.....#',
        '################################',
        '################################',
        '################################',
      ],
    },
    {
      name: 'The Conveyor',
      hint: 'It goes where it goes. Be standing on it when it does.',
      loops: 5, par: 3,
      rows: [
        '################################',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..........................a...#',
        '#..........................a...#',
        '#..........................a...#',
        '#.o....................1.o.a.X.#',
        '#####..................#########',
        '#..............................#',
        '#..............................#',
        '#..S...........................#',
        '################################',
        '################################',
        '################################',
      ],
      movers: [
        { x: 5, y: 13, w: 4, dx: 14, dy: 0, period: 420, phase: 0 },
      ],
    },
    {
      name: 'Convergence',
      hint: 'One pad kills the beam. One opens the gate. Neither is you.',
      loops: 6, par: 4,
      rows: [
        '################################',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#....................#.........#',
        '#....................#.........#',
        '#....................#.........#',
        '#.........o..........b.........#',
        '#........#####.......b...o..X..#',
        '#....................b..########',
        '#..S...1........2....b..########',
        '################################',
        '################################',
        '################################',
      ],
      lasers: [
        { x: 1, y: 14, dir: 'r', period: 180, on: 60, phase: 60 },
      ],
      plateDisarmsLasers: 0,
    },
  ];

  /* ---------------------------------------------------------
     3. level parsing
     --------------------------------------------------------- */
  function parseLevel(def) {
    const grid = new Uint8Array(COLS * ROWS);
    const orbs = [], plates = [], gates = [];
    let spawn = { x: 60, y: 60 }, exit = null;

    for (let y = 0; y < ROWS; y++) {
      const row = def.rows[y] || '';
      for (let x = 0; x < COLS; x++) {
        const c = row[x] || '.';
        const i = y * COLS + x;
        switch (c) {
          case '#': grid[i] = T_SOLID; break;
          case '=': grid[i] = T_ONEWAY; break;
          case '^': grid[i] = T_SPIKE; break;
          case 'S': spawn = { x: x * TILE + (TILE - PW) / 2, y: (y + 1) * TILE - PH }; break;
          case 'X': exit = { x, y }; break;
          case 'o': orbs.push({ x: x * TILE + TILE / 2, y: y * TILE + TILE / 2 }); break;
          case '1': case '2': case '3':
            plates.push({ x, y, id: +c - 1 }); break;
          case 'a': case 'b': case 'c':
            gates.push({ x, y, id: c.charCodeAt(0) - 97 }); break;
          default: grid[i] = T_EMPTY;
        }
      }
    }
    return {
      def, grid, orbs, plates, gates, spawn, exit,
      name: def.name, hint: def.hint, loops: def.loops, par: def.par,
      lasers: (def.lasers || []).map((l) => Object.assign({}, l)),
      movers: (def.movers || []).map((m) => Object.assign({}, m)),
      plateDisarmsLasers: def.plateDisarmsLasers,
      nGates: gates.length,
    };
  }

  // Catch authoring mistakes early rather than shipping a broken board.
  (function validateLevels() {
    LEVELS.forEach((L, i) => {
      if (L.rows.length !== ROWS) console.warn(`level ${i} "${L.name}": ${L.rows.length} rows, expected ${ROWS}`);
      L.rows.forEach((r, y) => {
        if (r.length !== COLS) console.warn(`level ${i} "${L.name}" row ${y}: width ${r.length}, expected ${COLS}`);
      });
      const flat = L.rows.join('');
      if ((flat.match(/S/g) || []).length !== 1) console.warn(`level ${i}: needs exactly one S`);
      if ((flat.match(/X/g) || []).length !== 1) console.warn(`level ${i}: needs exactly one X`);
    });
  })();

  /* ---------------------------------------------------------
     4. state
     --------------------------------------------------------- */
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d', { alpha: false });
  const audio = new A.AudioKit();
  const keys = new A.Keys();
  const fx = new A.Particles(1200);

  const G = {
    level: null,
    levelIndex: 0,
    frame: 0,
    takeIndex: 0,
    echoes: [],          // {x,y,fl:TypedArray, len, color}
    rec: null,
    takeStartOrb: [],
    orbMask: 0,
    player: null,
    status: 'title',     // title | playing | won | failed
    rewinding: false,
    hitstop: 0,
    shake: 0,
    time: 0,             // wall-clock seconds, for animation only
    flash: 0,
    plateOn: [false, false, false],
    lasersDisarmed: false,
    deathTimer: 0,
    winTimer: 0,
    started: false,
  };

  const progress = Store.get('ce:progress', {}); // { [levelIndex]: {loops, done} }

  function newPlayer(sp) {
    return {
      x: sp.x, y: sp.y, vx: 0, vy: 0,
      facing: 1, grounded: false, coyote: 0, buffer: 0,
      dead: false, sx: 1, sy: 1,
      trail: [],
      ridingDx: 0, ridingDy: 0,
    };
  }

  function blankRec() {
    return {
      x: new Float32Array(MAXF), y: new Float32Array(MAXF),
      vx: new Float32Array(MAXF), vy: new Float32Array(MAXF),
      fl: new Uint8Array(MAXF), orb: new Int32Array(MAXF),
      len: 0,
    };
  }

  /* ---------------------------------------------------------
     5. geometry helpers
     --------------------------------------------------------- */
  const tileAt = (cx, cy) => {
    if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS) return T_SOLID;
    return G.level.grid[cy * COLS + cx];
  };
  const overlap = (ax, ay, aw, ah, bx, by, bw, bh) =>
    ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;

  // Closed gates are solid; open ones are not.
  function gateSolidAt(cx, cy) {
    for (const g of G.level.gates) {
      if (g.x === cx && g.y === cy && !G.plateOn[g.id]) return true;
    }
    return false;
  }

  function solidAt(cx, cy) {
    return tileAt(cx, cy) === T_SOLID || gateSolidAt(cx, cy);
  }

  // Dynamic solids: echoes present this frame, plus moving platforms.
  function dynamicSolids() {
    const out = [];
    for (const e of G.echoes) {
      if (G.frame < e.len) {
        out.push({ x: e.x[G.frame], y: e.y[G.frame], w: PW, h: PH, kind: 'echo', ref: e });
      }
    }
    for (const m of G.level.movers) {
      const p = moverPos(m, G.frame);
      out.push({ x: p.x, y: p.y, w: m.w * TILE, h: 12, kind: 'mover', ref: m, prev: moverPos(m, G.frame - 1) });
    }
    return out;
  }

  function moverPos(m, frame) {
    const t = ((frame % m.period) + m.period) % m.period / m.period;
    const tri = 1 - Math.abs(2 * t - 1);       // 0..1..0
    const e = tri * tri * (3 - 2 * tri);       // eased
    return { x: (m.x + m.dx * e) * TILE, y: (m.y + m.dy * e) * TILE };
  }

  function laserOn(l) {
    if (G.lasersDisarmed) return false;
    return (((G.frame + l.phase) % l.period) + l.period) % l.period < l.on;
  }
  function laserWarn(l) {
    if (G.lasersDisarmed) return 0;
    const p = (((G.frame + l.phase) % l.period) + l.period) % l.period;
    const untilOn = p < l.on ? 0 : l.period - p;
    return untilOn > 0 && untilOn < 30 ? 1 - untilOn / 30 : 0;
  }
  // The beam runs from the emitter until it meets solid geometry, so a level
  // author never has to hand-count its length.
  function laserRect(l) {
    const step = { r: [1, 0], l: [-1, 0], d: [0, 1], u: [0, -1] }[l.dir] || [1, 0];
    let cx = l.x, cy = l.y, n = 0;
    while (n < 40) {
      const nx = cx + step[0], ny = cy + step[1];
      if (tileAt(nx, ny) === T_SOLID || gateSolidAt(nx, ny)) break;
      cx = nx; cy = ny; n++;
    }
    const len = n * TILE;
    if (l.dir === 'r') return { x: (l.x + 1) * TILE, y: l.y * TILE + TILE / 2 - 3, w: len, h: 6 };
    if (l.dir === 'l') return { x: cx * TILE, y: l.y * TILE + TILE / 2 - 3, w: len, h: 6 };
    if (l.dir === 'd') return { x: l.x * TILE + TILE / 2 - 3, y: (l.y + 1) * TILE, w: 6, h: len };
    return { x: l.x * TILE + TILE / 2 - 3, y: cy * TILE, w: 6, h: len };
  }

  /* ---------------------------------------------------------
     6. collision
     --------------------------------------------------------- */
  function staticBlocked(x, y, w, h) {
    const x0 = Math.floor(x / TILE), x1 = Math.floor((x + w - 0.001) / TILE);
    const y0 = Math.floor(y / TILE), y1 = Math.floor((y + h - 0.001) / TILE);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        if (solidAt(cx, cy)) return true;
      }
    }
    return false;
  }

  function moveX(p, dx, dyn) {
    p.x += dx;
    const x0 = Math.floor(p.x / TILE), x1 = Math.floor((p.x + PW - 0.001) / TILE);
    const y0 = Math.floor(p.y / TILE), y1 = Math.floor((p.y + PH - 0.001) / TILE);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        if (!solidAt(cx, cy)) continue;
        if (dx > 0) p.x = cx * TILE - PW; else p.x = (cx + 1) * TILE;
        p.vx = 0;
        return;
      }
    }
    for (const s of dyn) {
      if (s.kind === 'mover') continue; // movers are thin platforms — no side blocking
      if (overlap(p.x, p.y, PW, PH, s.x, s.y, s.w, s.h)) {
        if (dx > 0) p.x = s.x - PW; else p.x = s.x + s.w;
        p.vx = 0;
        return;
      }
    }
  }

  function moveY(p, dy, dyn) {
    const prevBottom = p.y + PH;
    p.y += dy;
    p.grounded = false;
    p.ridingDx = 0; p.ridingDy = 0;

    // Corner correction. Clipping a ceiling corner by a few pixels should slide
    // you around it, not cancel the jump — this is most of what makes the
    // echo-boost jumps feel fair.
    if (dy < 0 && staticBlocked(p.x, p.y, PW, PH)) {
      for (let n = 1; n <= 7; n++) {
        if (!staticBlocked(p.x + n, p.y, PW, PH)) { p.x += n; break; }
        if (!staticBlocked(p.x - n, p.y, PW, PH)) { p.x -= n; break; }
      }
    }

    const x0 = Math.floor(p.x / TILE), x1 = Math.floor((p.x + PW - 0.001) / TILE);
    const y0 = Math.floor(p.y / TILE), y1 = Math.floor((p.y + PH - 0.001) / TILE);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const t = tileAt(cx, cy);
        const solid = t === T_SOLID || gateSolidAt(cx, cy);
        const oneway = t === T_ONEWAY;
        if (solid) {
          if (dy > 0) { p.y = cy * TILE - PH; p.grounded = true; }
          else { p.y = (cy + 1) * TILE; }
          p.vy = 0;
          return;
        }
        if (oneway && dy > 0 && !keys.held('s', 'ArrowDown') && prevBottom <= cy * TILE + 1) {
          p.y = cy * TILE - PH; p.grounded = true; p.vy = 0;
          return;
        }
      }
    }
    for (const s of dyn) {
      if (!overlap(p.x, p.y, PW, PH, s.x, s.y, s.w, s.h)) continue;
      if (s.kind === 'mover') {
        // one-way: land on top only
        if (dy > 0 && prevBottom <= s.y + 4) {
          p.y = s.y - PH; p.grounded = true; p.vy = 0;
          if (s.prev) { p.ridingDx = s.x - s.prev.x; p.ridingDy = s.y - s.prev.y; }
          return;
        }
        continue;
      }
      if (dy > 0) {
        p.y = s.y - PH; p.grounded = true; p.vy = 0;
        const e = s.ref;
        if (G.frame > 0 && G.frame < e.len) {
          p.ridingDx = e.x[G.frame] - e.x[G.frame - 1];
          p.ridingDy = e.y[G.frame] - e.y[G.frame - 1];
        }
      } else {
        p.y = s.y + s.h; p.vy = 0;
      }
      return;
    }
  }

  /* ---------------------------------------------------------
     7. simulation step
     --------------------------------------------------------- */
  function computePlates() {
    const on = [false, false, false];
    const bodies = [];
    if (!G.player.dead) bodies.push({ x: G.player.x, y: G.player.y, w: PW, h: PH });
    for (const e of G.echoes) {
      if (G.frame < e.len) bodies.push({ x: e.x[G.frame], y: e.y[G.frame], w: PW, h: PH });
    }
    for (const pl of G.level.plates) {
      if (on[pl.id]) continue;
      const bx = pl.x * TILE, by = pl.y * TILE;
      for (const b of bodies) {
        if (overlap(b.x, b.y, b.w, b.h, bx + 2, by + TILE - 12, TILE - 4, 12)) { on[pl.id] = true; break; }
      }
    }
    return on;
  }

  function kill(reason) {
    if (G.player.dead) return;
    G.player.dead = true;
    G.deathTimer = 42;
    G.hitstop = 7;
    G.shake = 14;
    if (G.rec.len > 0) G.rec.fl[Math.max(0, G.frame - 1)] |= 4;
    G.rec.len = Math.min(G.rec.len, G.frame);
    fx.burst(G.player.x + PW / 2, G.player.y + PH / 2, 34, {
      color: PLAYER_COLOR, r: 3.5, grav: 620, drag: 0.93, glow: 12,
      spdMin: 60, spdMax: 340, lifeMin: 0.4, lifeMax: 1.0, shape: 'square',
    });
    fx.burst(G.player.x + PW / 2, G.player.y + PH / 2, 12, {
      color: '#ff5470', r: 5, grav: 200, drag: 0.9, glow: 18,
      spdMin: 20, spdMax: 160, lifeMin: 0.3, lifeMax: 0.7,
    });
    audio.noise({ dur: 0.4, gain: 0.3, type: 'lowpass', freq: 1400, to: 90, q: 2 });
    audio.tone({ freq: 300, to: 55, dur: 0.45, type: 'sawtooth', gain: 0.2 });
    toast(reason);
  }

  function step() {
    try { stepInner(); } finally { keys.endFrame(); }
  }

  function stepInner() {
    G.time += DT;
    if (G.hitstop > 0) { G.hitstop--; fx.update(DT); return; }
    if (G.status !== 'playing') { fx.update(DT); return; }

    const p = G.player;

    /* ---- rewind ---- */
    const wantRewind = keys.held('q') && G.frame > 0 && !G.player.dead;
    if (wantRewind) {
      if (!G.rewinding) {
        G.rewinding = true;
        audio.tone({ freq: 900, to: 300, dur: 0.25, type: 'triangle', gain: 0.14 });
      }
      G.frame = Math.max(0, G.frame - 3);
      const f = G.frame;
      p.x = G.rec.x[f]; p.y = G.rec.y[f];
      p.vx = G.rec.vx[f]; p.vy = G.rec.vy[f];
      p.facing = (G.rec.fl[f] & 1) ? 1 : -1;
      p.grounded = !!(G.rec.fl[f] & 2);
      G.orbMask = G.rec.orb[f];
      G.rec.len = f + 1;
      G.plateOn = computePlates();
      if (G.frame % 6 === 0) {
        fx.spawn({
          x: p.x + PW / 2 + (Math.random() - 0.5) * 26, y: p.y + PH / 2 + (Math.random() - 0.5) * 30,
          vx: 0, vy: -30, life: 0.4, max: 0.4, r: 2, color: '#b06bff', glow: 8, drag: 0.9,
        });
      }
      fx.update(DT);
      return;
    }
    if (G.rewinding) {
      G.rewinding = false;
      audio.tone({ freq: 300, to: 800, dur: 0.18, type: 'triangle', gain: 0.14 });
    }

    /* ---- world state that depends only on the frame counter ---- */
    G.plateOn = computePlates();
    if (G.level.plateDisarmsLasers !== undefined) {
      G.lasersDisarmed = G.plateOn[G.level.plateDisarmsLasers];
    }
    const dyn = dynamicSolids();

    /* ---- death animation, then roll the loop ---- */
    if (p.dead) {
      G.deathTimer--;
      if (G.deathTimer <= 0) endTake();
      fx.update(DT);
      return;
    }

    /* ---- input ---- */
    const left = keys.held('a', 'ArrowLeft');
    const right = keys.held('d', 'ArrowRight');
    const dir = (right ? 1 : 0) - (left ? 1 : 0);
    if (dir) p.facing = dir;

    if (keys.hit('w', 'ArrowUp', ' ')) p.buffer = BUFFER;
    if (p.buffer > 0) p.buffer--;
    if (p.grounded) p.coyote = COYOTE; else if (p.coyote > 0) p.coyote--;

    /* ---- horizontal ---- */
    const acc = p.grounded ? ACC_G : ACC_A;
    const fric = p.grounded ? FRIC_G : FRIC_A;
    if (dir !== 0) {
      p.vx += dir * acc * DT;
      p.vx = clamp(p.vx, -RUN, RUN);
    } else {
      const s = Math.sign(p.vx);
      p.vx -= s * fric * DT;
      if (Math.sign(p.vx) !== s) p.vx = 0;
    }

    /* ---- jump ---- */
    if (p.buffer > 0 && p.coyote > 0) {
      p.vy = -JUMP;
      p.buffer = 0; p.coyote = 0; p.grounded = false;
      p.sx = 0.74; p.sy = 1.3;
      audio.tone({ freq: 420, to: 700, dur: 0.1, type: 'square', gain: 0.1 });
      fx.burst(p.x + PW / 2, p.y + PH, 7, {
        color: 'rgba(200,230,255,0.75)', r: 2.4, grav: 260, drag: 0.9,
        spdMin: 20, spdMax: 90, lifeMin: 0.15, lifeMax: 0.35, vy: 30,
      });
    }
    if (keys.let_go('w', 'ArrowUp', ' ') && p.vy < 0) p.vy *= CUT;

    /* ---- gravity ---- */
    p.vy = Math.min(p.vy + GRAV * DT, MAXFALL);

    /* ---- integrate ---- */
    const wasGrounded = p.grounded;
    // carry with whatever we were standing on last frame
    if (p.ridingDx || p.ridingDy) { p.x += p.ridingDx; p.y += p.ridingDy; }
    moveX(p, p.vx * DT, dyn);
    moveY(p, p.vy * DT, dyn);

    if (!wasGrounded && p.grounded) {
      p.sx = 1.32; p.sy = 0.7;
      const impact = clamp(Math.abs(p.vy) / MAXFALL, 0, 1);
      audio.noise({ dur: 0.08, gain: 0.05 + impact * 0.12, type: 'lowpass', freq: 500 + impact * 900, to: 160 });
      fx.burst(p.x + PW / 2, p.y + PH, 4 + Math.round(impact * 8), {
        color: 'rgba(190,220,255,0.7)', r: 2.6, grav: 300, drag: 0.88,
        spdMin: 30, spdMax: 130 * (0.4 + impact), lifeMin: 0.15, lifeMax: 0.4,
      });
    }
    p.sx = approach(p.sx, 1, 0.0001, DT);
    p.sy = approach(p.sy, 1, 0.0001, DT);

    /* ---- crush ---- */
    if (staticBlocked(p.x, p.y, PW, PH)) {
      let freed = false;
      for (const [ox, oy] of [[0, -1], [0, -2], [1, 0], [-1, 0], [0, 1], [2, 0], [-2, 0], [0, -3]]) {
        if (!staticBlocked(p.x + ox, p.y + oy, PW, PH)) { p.x += ox; p.y += oy; freed = true; break; }
      }
      if (!freed) kill('crushed');
    }

    /* ---- hazards ---- */
    if (!p.dead) {
      const cx0 = Math.floor(p.x / TILE), cx1 = Math.floor((p.x + PW - 1) / TILE);
      const cy0 = Math.floor(p.y / TILE), cy1 = Math.floor((p.y + PH - 1) / TILE);
      outer:
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          if (tileAt(cx, cy) === T_SPIKE &&
              overlap(p.x, p.y, PW, PH, cx * TILE + 4, cy * TILE + 12, TILE - 8, TILE - 12)) {
            kill('impaled'); break outer;
          }
        }
      }
    }
    if (!p.dead) {
      for (const l of G.level.lasers) {
        if (!laserOn(l)) continue;
        const r = laserRect(l);
        if (overlap(p.x, p.y, PW, PH, r.x, r.y, r.w, r.h)) { kill('vaporised'); break; }
      }
    }
    if (!p.dead && p.y > VH + 60) kill('lost');

    /* ---- orbs ---- */
    if (!p.dead) {
      G.level.orbs.forEach((o, i) => {
        if (G.orbMask & (1 << i)) return;
        if (overlap(p.x, p.y, PW, PH, o.x - 13, o.y - 13, 26, 26)) {
          G.orbMask |= (1 << i);
          const n = countOrbs();
          audio.tone({ freq: 620 * Math.pow(1.1892, n), dur: 0.32, type: 'triangle', gain: 0.2, send: 0.4 });
          audio.tone({ freq: 1240 * Math.pow(1.1892, n), dur: 0.22, type: 'sine', gain: 0.1, delay: 0.02 });
          fx.burst(o.x, o.y, 26, {
            color: '#ffcc55', r: 3, grav: -30, drag: 0.9, glow: 14,
            spdMin: 40, spdMax: 200, lifeMin: 0.3, lifeMax: 0.9,
          });
          G.flash = 0.35;
          paintOrbs();
        }
      });
    }

    /* ---- exit ---- */
    if (!p.dead && G.level.exit && allOrbs()) {
      const e = G.level.exit;
      if (overlap(p.x, p.y, PW, PH, e.x * TILE + 4, e.y * TILE + 2, TILE - 8, TILE - 2)) {
        win();
      }
    }

    /* ---- record ---- */
    if (G.frame < MAXF) {
      const f = G.frame;
      G.rec.x[f] = p.x; G.rec.y[f] = p.y;
      G.rec.vx[f] = p.vx; G.rec.vy[f] = p.vy;
      G.rec.fl[f] = (p.facing > 0 ? 1 : 0) | (p.grounded ? 2 : 0);
      G.rec.orb[f] = G.orbMask;
      G.rec.len = f + 1;
    }

    /* ---- trail ---- */
    p.trail.unshift({ x: p.x, y: p.y });
    if (p.trail.length > 10) p.trail.pop();

    /* ---- advance ---- */
    G.frame++;
    if (G.frame >= MAXF) endTake();

    fx.update(DT);
    G.shake = approach(G.shake, 0, 0.00005, DT);
    G.flash = approach(G.flash, 0, 0.0001, DT);
  }

  const countOrbs = () => {
    let n = 0;
    for (let i = 0; i < G.level.orbs.length; i++) if (G.orbMask & (1 << i)) n++;
    return n;
  };
  const allOrbs = () => countOrbs() === G.level.orbs.length;

  /* ---------------------------------------------------------
     8. take lifecycle
     --------------------------------------------------------- */
  function makeEcho(rec, idx) {
    const n = rec.len;
    const e = {
      x: rec.x.slice(0, n), y: rec.y.slice(0, n), fl: rec.fl.slice(0, n),
      len: n, color: ECHO_COLORS[idx % ECHO_COLORS.length],
      died: n < MAXF,
    };
    return e;
  }

  function endTake() {
    if (G.status !== 'playing') return;
    if (G.rec.len > 0) G.echoes.push(makeEcho(G.rec, G.takeIndex));
    G.takeIndex++;

    if (G.takeIndex >= G.level.loops) {
      G.status = 'failed';
      audio.tone({ freq: 220, to: 70, dur: 1.1, type: 'sawtooth', gain: 0.18 });
      audio.noise({ dur: 0.9, gain: 0.16, type: 'lowpass', freq: 900, to: 60 });
      show('ovFail');
      return;
    }
    startTake();
    audio.tone({ freq: 180, to: 460, dur: 0.3, type: 'triangle', gain: 0.16 });
    audio.noise({ dur: 0.35, gain: 0.1, type: 'highpass', freq: 300, to: 3000 });
    G.shake = 6;
    toast('take ' + (G.takeIndex + 1));
  }

  function startTake() {
    G.frame = 0;
    G.takeStartOrb[G.takeIndex] = G.orbMask;
    G.rec = blankRec();
    G.player = newPlayer(G.level.spawn);
    G.plateOn = computePlates();
    fx.burst(G.level.spawn.x + PW / 2, G.level.spawn.y + PH / 2, 20, {
      color: '#5df2d6', r: 3, drag: 0.88, glow: 12,
      spdMin: 40, spdMax: 190, lifeMin: 0.25, lifeMax: 0.6,
    });
    paintHud();
  }

  function undoEcho() {
    if (G.status !== 'playing' || G.echoes.length === 0) return;
    G.echoes.pop();
    G.takeIndex--;
    G.orbMask = G.takeStartOrb[G.takeIndex] || 0;
    startTake();
    audio.tone({ freq: 700, to: 200, dur: 0.22, type: 'square', gain: 0.12 });
    toast('echo deleted');
  }

  function win() {
    G.status = 'won';
    G.winTimer = 0;
    const used = G.takeIndex + 1;
    const prev = progress[G.levelIndex];
    const best = prev && prev.loops ? Math.min(prev.loops, used) : used;
    progress[G.levelIndex] = { done: true, loops: best };
    Store.set('ce:progress', progress);

    audio.chord([523, 659, 784, 1047], { dur: 0.9, type: 'triangle', gain: 0.16, spread: 0.06, send: 0.5 });
    fx.burst(G.player.x + PW / 2, G.player.y + PH / 2, 60, {
      color: '#5df2d6', r: 4, drag: 0.92, glow: 16,
      spdMin: 60, spdMax: 320, lifeMin: 0.5, lifeMax: 1.3,
    });
    G.flash = 0.8;

    // Result panel
    const par = G.level.par;
    document.getElementById('resTitle').textContent = G.level.name;
    document.getElementById('resKicker').textContent =
      used <= par ? 'Clean loop' : 'Loop closed';
    document.getElementById('resStats').innerHTML =
      `<div class="stat"><div class="v ${used <= par ? 'good' : ''}">${used}</div><div class="k">takes used</div></div>` +
      `<div class="stat"><div class="v">${par}</div><div class="k">par</div></div>` +
      `<div class="stat"><div class="v">${best}</div><div class="k">your best</div></div>`;
    document.getElementById('resNote').textContent =
      used < par ? 'Under par. That is not supposed to be possible.'
      : used === par ? 'Exactly par. The tidy solution.'
      : 'It worked. There is a shorter way through.';
    const next = document.getElementById('resNext');
    next.textContent = G.levelIndex + 1 < LEVELS.length ? 'next fracture' : 'back to arcade';
    setTimeout(() => show('ovResult'), 700);
  }

  /* ---------------------------------------------------------
     9. rendering
     --------------------------------------------------------- */
  let bgCanvas = null;

  function bakeBackground() {
    bgCanvas = document.createElement('canvas');
    bgCanvas.width = VW; bgCanvas.height = VH;
    const b = bgCanvas.getContext('2d');
    const L = G.level;

    // sky
    const grad = b.createLinearGradient(0, 0, 0, VH);
    grad.addColorStop(0, '#0d1024');
    grad.addColorStop(0.55, '#0a0c1b');
    grad.addColorStop(1, '#070810');
    b.fillStyle = grad;
    b.fillRect(0, 0, VW, VH);

    // faint grid
    b.strokeStyle = 'rgba(255,255,255,0.022)';
    b.lineWidth = 1;
    b.beginPath();
    for (let x = 0; x <= COLS; x++) { b.moveTo(x * TILE + 0.5, 0); b.lineTo(x * TILE + 0.5, VH); }
    for (let y = 0; y <= ROWS; y++) { b.moveTo(0, y * TILE + 0.5); b.lineTo(VW, y * TILE + 0.5); }
    b.stroke();

    // solid tiles
    const rng = Rng('bg' + L.name);
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const t = L.grid[y * COLS + x];
        if (t !== T_SOLID) continue;
        const px = x * TILE, py = y * TILE;
        b.fillStyle = '#171d33';
        b.fillRect(px, py, TILE, TILE);
        // speckle
        b.fillStyle = 'rgba(255,255,255,0.018)';
        for (let i = 0; i < 3; i++) {
          b.fillRect(px + rng() * TILE, py + rng() * TILE, 2, 2);
        }
        // edges where exposed
        const up = tileAt(x, y - 1) !== T_SOLID;
        if (up) {
          b.fillStyle = '#38477a';
          b.fillRect(px, py, TILE, 3);
          b.fillStyle = 'rgba(93,242,214,0.10)';
          b.fillRect(px, py + 3, TILE, 5);
        }
        b.fillStyle = 'rgba(0,0,0,0.35)';
        if (tileAt(x, y + 1) !== T_SOLID) b.fillRect(px, py + TILE - 3, TILE, 3);
        b.fillStyle = 'rgba(255,255,255,0.03)';
        if (tileAt(x - 1, y) !== T_SOLID) b.fillRect(px, py, 2, TILE);
        if (tileAt(x + 1, y) !== T_SOLID) b.fillRect(px + TILE - 2, py, 2, TILE);
      }
      }

    // one-way platforms
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (L.grid[y * COLS + x] !== T_ONEWAY) continue;
        const px = x * TILE, py = y * TILE;
        b.fillStyle = '#2b3358';
        b.fillRect(px, py, TILE, 7);
        b.fillStyle = '#4b5a97';
        b.fillRect(px, py, TILE, 2);
      }
    }

    // spikes
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (L.grid[y * COLS + x] !== T_SPIKE) continue;
        const px = x * TILE, py = y * TILE;
        const g2 = b.createLinearGradient(0, py + TILE, 0, py);
        g2.addColorStop(0, '#5c2233');
        g2.addColorStop(1, '#ff5470');
        b.fillStyle = g2;
        for (let i = 0; i < 3; i++) {
          const sx = px + i * 10;
          b.beginPath();
          b.moveTo(sx, py + TILE);
          b.lineTo(sx + 5, py + 8);
          b.lineTo(sx + 10, py + TILE);
          b.closePath(); b.fill();
        }
      }
    }

    // vignette
    const v = b.createRadialGradient(VW / 2, VH / 2, VH * 0.32, VW / 2, VH / 2, VH * 0.92);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.40)');
    b.fillStyle = v;
    b.fillRect(0, 0, VW, VH);
  }

  function drawBody(c, x, y, color, opts) {
    const o = opts || {};
    const sx = o.sx || 1, sy = o.sy || 1;
    const cx = x + PW / 2, cy = y + PH;
    c.save();
    c.translate(cx, cy);
    c.scale(sx, sy);
    c.translate(-cx, -cy);

    const w = PW, h = PH;
    if (o.glow) { c.shadowBlur = o.glow; c.shadowColor = color; }
    c.fillStyle = color;
    c.globalAlpha = o.alpha == null ? 1 : o.alpha;
    A.roundRect(c, x, y, w, h, 6);
    c.fill();
    c.shadowBlur = 0;

    // inner face
    c.globalAlpha = (o.alpha == null ? 1 : o.alpha) * 0.9;
    c.fillStyle = 'rgba(4,6,14,0.72)';
    A.roundRect(c, x + 3, y + 4, w - 6, h - 8, 4);
    c.fill();

    // eyes
    const f = o.facing || 1;
    c.fillStyle = color;
    c.globalAlpha = o.alpha == null ? 1 : o.alpha;
    const ex = x + (f > 0 ? w - 9 : 4);
    c.fillRect(ex, y + 8, 4, 5);
    c.fillRect(ex + (f > 0 ? -6 : 6), y + 8, 3, 5);
    c.restore();
    c.globalAlpha = 1;
  }

  function render(alpha) {
    const shake = G.shake;
    ctx.save();
    if (shake > 0.2) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }

    ctx.drawImage(bgCanvas, 0, 0);

    const L = G.level;
    const t = G.time;

    /* ---- drifting time-dust ---- */
    ctx.save();
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < 26; i++) {
      const seed = i * 97.13;
      const dx = (seed * 37 % VW + t * (6 + (i % 4) * 5)) % VW;
      const dy = (seed * 53 % VH + Math.sin(t * 0.3 + i) * 14 + VH) % VH;
      ctx.fillStyle = i % 5 === 0 ? 'rgba(176,107,255,0.35)' : 'rgba(140,170,255,0.18)';
      ctx.fillRect(dx, dy, 1.6, 1.6);
    }
    ctx.restore();

    /* ---- movers ---- */
    for (const m of L.movers) {
      const p = moverPos(m, G.frame);
      const w = m.w * TILE;
      ctx.save();
      ctx.shadowBlur = 14; ctx.shadowColor = '#6b9dff';
      ctx.fillStyle = '#2c3765';
      A.roundRect(ctx, p.x, p.y, w, 12, 4); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#6b9dff';
      A.roundRect(ctx, p.x, p.y, w, 3, 2); ctx.fill();
      // travel rail
      ctx.strokeStyle = 'rgba(107,157,255,0.13)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(m.x * TILE + w / 2, m.y * TILE + 6);
      ctx.lineTo((m.x + m.dx) * TILE + w / 2, (m.y + m.dy) * TILE + 6);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    /* ---- plates ---- */
    for (const pl of L.plates) {
      const px = pl.x * TILE, py = pl.y * TILE;
      const on = G.plateOn[pl.id];
      const col = ['#5df2d6', '#ffcc55', '#ff6bd6'][pl.id] || '#5df2d6';
      const drop = on ? 5 : 0;
      ctx.save();
      // beam
      if (on) {
        ctx.globalAlpha = 0.16 + Math.sin(t * 6) * 0.03;
        ctx.fillStyle = col;
        ctx.fillRect(px + 3, py - 150, TILE - 6, 150 + TILE);
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = 'rgba(6,8,18,0.9)';
      A.roundRect(ctx, px + 2, py + TILE - 14, TILE - 4, 12, 3); ctx.fill();
      ctx.shadowBlur = on ? 16 : 6; ctx.shadowColor = col;
      ctx.fillStyle = on ? col : 'rgba(120,140,190,0.5)';
      A.roundRect(ctx, px + 4, py + TILE - 12 + drop, TILE - 8, 7 - drop * 0.5, 3); ctx.fill();
      ctx.restore();
    }

    /* ---- gates (behind echoes so an out-of-time echo reads as a ghost) ---- */
    drawGates(ctx, t, false);

    /* ---- echoes ---- */
    G.echoes.forEach((e, i) => {
      if (G.frame >= e.len) {
        // show the moment it ended, faintly, for one beat
        return;
      }
      const ex = e.x[G.frame], ey = e.y[G.frame];
      const facing = (e.fl[G.frame] & 1) ? 1 : -1;
      const jitter = Math.sin(t * 30 + i * 2) * 0.35;
      ctx.save();
      ctx.globalAlpha = 0.30;
      drawBody(ctx, ex + jitter - 2, ey, e.color, { alpha: 0.3, glow: 20, facing });
      ctx.restore();
      drawBody(ctx, ex + jitter, ey, e.color, { alpha: 0.72, glow: 10, facing });
      // scanlines
      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = '#000';
      for (let sy = 0; sy < PH; sy += 3) ctx.fillRect(ex, ey + sy, PW, 1);
      ctx.restore();
      // index tag
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = e.color;
      ctx.font = '700 8px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(String(i + 1), ex + PW / 2, ey - 5);
      ctx.restore();
    });

    /* ---- orbs ---- */
    L.orbs.forEach((o, i) => {
      if (G.orbMask & (1 << i)) return;
      const pulse = 1 + Math.sin(t * 3 + i * 1.7) * 0.09;
      ctx.save();
      ctx.shadowBlur = 22; ctx.shadowColor = '#ffcc55';
      const g = ctx.createRadialGradient(o.x, o.y, 1, o.x, o.y, 11 * pulse);
      g.addColorStop(0, '#fff6d8');
      g.addColorStop(0.5, '#ffcc55');
      g.addColorStop(1, 'rgba(255,160,40,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(o.x, o.y, 11 * pulse, 0, TAU); ctx.fill();
      ctx.shadowBlur = 0;
      // orbiting sparks
      for (let s = 0; s < 3; s++) {
        const a = t * 1.9 + s * TAU / 3 + i;
        const rr = 15 + Math.sin(t * 2 + s) * 2.5;
        ctx.fillStyle = 'rgba(255,225,150,0.85)';
        ctx.beginPath();
        ctx.arc(o.x + Math.cos(a) * rr, o.y + Math.sin(a) * rr * 0.62, 1.7, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    });

    /* ---- lasers ---- */
    for (const l of L.lasers) {
      const r = laserRect(l);
      const on = laserOn(l);
      const warn = laserWarn(l);
      ctx.save();
      // emitter
      ctx.fillStyle = '#3a2030';
      ctx.fillRect(l.x * TILE + 6, l.y * TILE + 6, TILE - 12, TILE - 12);
      ctx.fillStyle = on ? '#ff5470' : warn > 0 ? '#ff9aa8' : '#6a4050';
      ctx.beginPath();
      ctx.arc(l.x * TILE + TILE / 2, l.y * TILE + TILE / 2, 5, 0, TAU);
      ctx.fill();
      if (on) {
        ctx.shadowBlur = 22; ctx.shadowColor = '#ff5470';
        ctx.fillStyle = 'rgba(255,84,112,0.9)';
        ctx.fillRect(r.x, r.y + 1, r.w, r.h - 2);
        ctx.fillStyle = '#ffd6de';
        ctx.fillRect(r.x, r.y + 2.5, r.w, 1.4);
      } else if (warn > 0) {
        ctx.globalAlpha = warn * (0.35 + Math.sin(t * 40) * 0.25);
        ctx.strokeStyle = '#ff5470';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.moveTo(r.x, r.y + 3); ctx.lineTo(r.x + r.w, r.y + 3);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    }

    /* ---- gates (front layer: frame + glow) ---- */
    drawGates(ctx, t, true);

    /* ---- exit ---- */
    if (L.exit) {
      const ex = L.exit.x * TILE + TILE / 2, ey = L.exit.y * TILE + TILE / 2;
      const open = allOrbs();
      ctx.save();
      ctx.translate(ex, ey);
      const col = open ? '#5df2d6' : '#4a5578';
      ctx.shadowBlur = open ? 24 : 6; ctx.shadowColor = col;
      for (let r = 0; r < 3; r++) {
        const rad = 8 + r * 5;
        const spin = t * (open ? 1.6 : 0.3) * (r % 2 ? -1 : 1) + r;
        ctx.strokeStyle = col;
        ctx.globalAlpha = open ? 0.9 - r * 0.2 : 0.4 - r * 0.08;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(0, 0, rad, spin, spin + TAU * (open ? 0.68 : 0.45));
        ctx.stroke();
      }
      if (open) {
        ctx.globalAlpha = 0.5 + Math.sin(t * 4) * 0.16;
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 13);
        g.addColorStop(0, 'rgba(255,255,255,0.9)');
        g.addColorStop(1, 'rgba(93,242,214,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(0, 0, 13, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }

    /* ---- player ---- */
    const p = G.player;
    if (p && !p.dead) {
      // trail
      p.trail.forEach((tp, i) => {
        const a = (1 - i / p.trail.length) * 0.16;
        ctx.globalAlpha = a;
        ctx.fillStyle = PLAYER_COLOR;
        A.roundRect(ctx, tp.x + 2, tp.y + 2, PW - 4, PH - 4, 5);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
      drawBody(ctx, p.x, p.y, PLAYER_COLOR, {
        glow: 16, facing: p.facing, sx: p.sx, sy: p.sy,
      });
    }

    fx.draw(ctx);

    /* ---- rewind overlay ---- */
    if (G.rewinding) {
      ctx.save();
      ctx.globalAlpha = 0.10;
      ctx.fillStyle = '#b06bff';
      ctx.fillRect(0, 0, VW, VH);
      ctx.globalAlpha = 0.13;
      ctx.fillStyle = '#000';
      for (let y = (t * 900) % 8; y < VH; y += 8) ctx.fillRect(0, y, VW, 2);
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#e6d5ff';
      ctx.font = '600 11px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('◄◄  R E W I N D I N G', VW / 2, 76);
      ctx.restore();
    }

    /* ---- flash ---- */
    if (G.flash > 0.01) {
      ctx.globalAlpha = G.flash * 0.5;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, VW, VH);
      ctx.globalAlpha = 1;
    }

    /* ---- scanlines ---- */
    ctx.save();
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = '#000';
    for (let y = 0; y < VH; y += 3) ctx.fillRect(0, y, VW, 1);
    ctx.restore();

    ctx.restore();
  }

  function drawGates(c, t, front) {
    for (const g of G.level.gates) {
      const open = G.plateOn[g.id];
      const px = g.x * TILE, py = g.y * TILE;
      const col = ['#5df2d6', '#ffcc55', '#ff6bd6'][g.id] || '#5df2d6';
      c.save();
      if (!front) {
        if (open) {
          c.globalAlpha = 0.12;
          c.fillStyle = col;
          c.fillRect(px + 5, py, TILE - 10, TILE);
        } else {
          c.fillStyle = 'rgba(10,14,28,0.94)';
          c.fillRect(px + 2, py, TILE - 4, TILE);
        }
      } else {
        c.strokeStyle = col;
        c.globalAlpha = open ? 0.3 : 0.85;
        c.lineWidth = 2;
        c.strokeRect(px + 2.5, py + 0.5, TILE - 5, TILE - 1);
        if (!open) {
          c.shadowBlur = 12; c.shadowColor = col;
          c.globalAlpha = 0.7;
          for (let i = 0; i < 3; i++) {
            const yy = py + ((t * 44 + i * 11 + g.y * 7) % TILE);
            c.fillStyle = col;
            c.fillRect(px + 4, yy, TILE - 8, 1.6);
          }
          c.globalAlpha = 0.28;
          c.fillStyle = col;
          c.fillRect(px + 4, py + 2, TILE - 8, TILE - 4);
        }
      }
      c.restore();
    }
  }

  /* ---------------------------------------------------------
     10. HUD
     --------------------------------------------------------- */
  const $ = (id) => document.getElementById(id);
  let toastTimer = 0;

  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1100);
  }

  function paintOrbs() {
    const wrap = $('hudOrbs');
    wrap.innerHTML = '';
    G.level.orbs.forEach((_, i) => {
      const d = document.createElement('div');
      d.className = 'orb-pip' + ((G.orbMask & (1 << i)) ? ' got' : '');
      wrap.appendChild(d);
    });
  }

  function paintHud() {
    $('hudLvlNo').textContent = String(G.levelIndex + 1).padStart(2, '0');
    $('hudLvlName').textContent = G.level.name;
    $('hudLvlHint').textContent = G.level.hint;
    paintOrbs();

    const tracks = $('tlTracks');
    tracks.innerHTML = '';
    for (let i = 0; i < G.level.loops; i++) {
      const tr = document.createElement('div');
      tr.className = 'tl-track';
      if (i < G.echoes.length) {
        const e = G.echoes[i];
        const f = document.createElement('div');
        f.className = 'fill';
        f.style.width = (e.len / MAXF * 100) + '%';
        f.style.background = e.color;
        tr.appendChild(f);
        if (e.died) {
          const d = document.createElement('div');
          d.className = 'death';
          d.style.left = (e.len / MAXF * 100) + '%';
          tr.appendChild(d);
        }
      } else if (i === G.takeIndex) {
        tr.classList.add('live');
        const f = document.createElement('div');
        f.className = 'fill';
        f.style.background = PLAYER_COLOR;
        f.style.width = '0%';
        f.id = 'tlLiveFill';
        tr.appendChild(f);
      } else {
        tr.classList.add('pending');
      }
      tracks.appendChild(tr);
    }
    $('tlTakeLabel').textContent = `take ${G.takeIndex + 1} / ${G.level.loops}`;
  }

  function tickHud() {
    const pct = G.frame / MAXF;
    const live = $('tlLiveFill');
    if (live) live.style.width = (pct * 100) + '%';
    const ph = $('tlPlayhead');
    const tl = $('timeline');
    ph.style.left = (10 + pct * (tl.clientWidth - 20)) + 'px';
    const remain = (MAXF - G.frame) / HZ;
    const clock = $('tlClock');
    clock.textContent = remain.toFixed(1);
    clock.classList.toggle('low', remain < 3.5);
  }

  /* ---------------------------------------------------------
     11. overlays / flow
     --------------------------------------------------------- */
  const OVERLAYS = ['ovLevels', 'ovHelp', 'ovResult', 'ovFail', 'ovStart'];
  function show(id) { OVERLAYS.forEach((o) => { $(o).hidden = o !== id; }); }
  function hideAll() { OVERLAYS.forEach((o) => { $(o).hidden = true; }); }
  const anyOverlay = () => OVERLAYS.some((o) => !$(o).hidden);

  function loadLevel(i) {
    G.levelIndex = clamp(i, 0, LEVELS.length - 1);
    G.level = parseLevel(LEVELS[G.levelIndex]);
    G.echoes = [];
    G.takeIndex = 0;
    G.takeStartOrb = [];
    G.orbMask = 0;
    G.status = 'playing';
    G.lasersDisarmed = false;
    G.shake = 0; G.flash = 0; G.hitstop = 0;
    fx.clear();
    bakeBackground();
    startTake();
    paintHud();
    hideAll();
    Store.set('ce:last', G.levelIndex);
  }

  function paintLevelGrid() {
    const grid = $('lvlGrid');
    grid.innerHTML = '';
    LEVELS.forEach((L, i) => {
      const pr = progress[i];
      const unlockedBy = i === 0 || progress[i - 1];
      const b = document.createElement('button');
      b.className = 'lvl-card' + (pr ? ' done' : '') + (pr && pr.loops <= L.par ? ' perfect' : '') + (unlockedBy ? '' : ' locked');
      b.innerHTML =
        `<div class="n">${String(i + 1).padStart(2, '0')}</div>` +
        `<div class="nm">${unlockedBy ? L.name : '— locked —'}</div>` +
        `<div class="sc">${pr ? `best ${pr.loops} · par ${L.par}` : unlockedBy ? `par ${L.par}` : 'finish the last one'}</div>`;
      if (unlockedBy) b.addEventListener('click', () => { audio.unlock(); loadLevel(i); });
      grid.appendChild(b);
    });
  }

  /* ---------------------------------------------------------
     12. wiring
     --------------------------------------------------------- */
  A.mountChrome(audio);

  $('startBtn').addEventListener('click', () => {
    audio.unlock();
    audio.setReverb(0.18);
    G.started = true;
    loadLevel(Store.get('ce:last', 0));
  });
  $('helpBtn').addEventListener('click', () => { paintLevelGrid(); show('ovHelp'); });
  $('closeHelp').addEventListener('click', () => { if (G.started) hideAll(); else show('ovStart'); });
  $('levelsBtn').addEventListener('click', () => { paintLevelGrid(); show('ovLevels'); });
  $('closeLevels').addEventListener('click', () => { if (G.started) hideAll(); else show('ovStart'); });
  $('wipeBtn').addEventListener('click', () => {
    Object.keys(progress).forEach((k) => delete progress[k]);
    Store.set('ce:progress', progress);
    paintLevelGrid();
    toast('progress erased');
  });
  $('resRetry').addEventListener('click', () => loadLevel(G.levelIndex));
  $('resNext').addEventListener('click', () => {
    if (G.levelIndex + 1 < LEVELS.length) loadLevel(G.levelIndex + 1);
    else window.location.href = '../../index.html';
  });
  $('failRetry').addEventListener('click', () => loadLevel(G.levelIndex));
  $('failLevels').addEventListener('click', () => { paintLevelGrid(); show('ovLevels'); });

  window.addEventListener('keydown', (e) => {
    if (!G.started) return;
    audio.unlock();
    if (e.key === 'Escape') { if (anyOverlay()) { if (G.status === 'playing') hideAll(); } else { paintLevelGrid(); show('ovLevels'); } }
    if (anyOverlay()) return;
    if (e.key === 'r' || e.key === 'R') { loadLevel(G.levelIndex); }
    if (e.key === 'Enter') { if (G.status === 'playing' && !G.player.dead) endTake(); }
    if (e.key === 'Backspace') { e.preventDefault(); undoEcho(); }
  });

  const loop = A.Loop({
    hz: HZ,
    step,
    render: (alpha) => {
      if (G.level) { render(alpha); tickHud(); }
      else {
        ctx.fillStyle = '#07070f';
        ctx.fillRect(0, 0, VW, VH);
      }
    },
  });

  /* ---------------------------------------------------------
     13. debug hook
     Lets the simulation be driven synchronously (the render loop is
     rAF-bound, which browsers pause when the page isn't visible).
     --------------------------------------------------------- */
  window.__CE = {
    G, keys, LEVELS, loadLevel, parseLevel,
    consts: { TILE, PW, PH, GRAV, JUMP, RUN, MAXF, COLS, ROWS },
    press(k) { keys.down[k] = true; keys.pressed[k] = true; },
    release(k) { keys.down[k] = false; keys.released[k] = true; },
    tick(n = 1) { for (let i = 0; i < n; i++) step(); },
    paint() { render(1); tickHud(); },
    player() {
      const p = G.player;
      return { x: p.x, y: p.y, vx: p.vx, vy: p.vy, grounded: p.grounded, dead: p.dead };
    },
    state() {
      return {
        status: G.status, frame: G.frame, take: G.takeIndex,
        echoes: G.echoes.length, orbs: countOrbs(), total: G.level.orbs.length,
        plates: G.plateOn.slice(), level: G.level.name,
      };
    },
  };

  // start on the title card
  ctx.fillStyle = '#07070f';
  ctx.fillRect(0, 0, VW, VH);
  show('ovStart');
  loop.start();
})();
