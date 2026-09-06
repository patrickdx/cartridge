/* ============================================================
   DECOY
   You have no weapon. Time moves when you move.

   Everything in the room wants to reach you and none of it looks
   where it is going. That is the whole design: enemies step greedily
   toward your square and are completely blind to the pits in the
   floor, so the only weapon in the game is *where you choose to
   stand*. Lancer fire and bomber blasts give a faster, showier route
   — they kill their own kind too — but the pits are what guarantee
   every room can always be cleared.
   ============================================================ */
(function () {
  'use strict';

  const A = window.Arcade;
  const { clamp, lerp, approach, TAU, Store, Rng } = A;

  /* ---------------------------------------------------------
     constants
     --------------------------------------------------------- */
  const COLS = 11, ROWS = 9, CELL = 60;
  const VW = COLS * CELL, VH = ROWS * CELL;
  const ANIM = 0.13;                       // seconds per resolved turn

  const T_FLOOR = 0, T_WALL = 1, T_PIT = 2;

  const KIND = {
    charger: {
      color: '#ff5a4d', label: 'Charger',
      blurb: 'Steps toward you every turn and kills on touch. Sees nothing else.',
    },
    lancer: {
      color: '#ff9d3d', label: 'Lancer',
      blurb: 'Lines up on your row or column, marks the shot, then fires it the next turn. ' +
             'The bolt goes through everything in its way — including other enemies.',
    },
    bomber: {
      color: '#ffd93d', label: 'Bomber',
      blurb: 'Walks toward you with a lit fuse. When it reaches zero it takes out everything ' +
             'in the nine squares around it, itself included.',
    },
    mirror: {
      color: '#c07bff', label: 'Mirror',
      blurb: 'Copies your move backwards — you go left, it goes right. Kills on touch, ' +
             'and it is the one enemy you can steer.',
    },
  };

  const DIRS = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] };
  const OPP = { U: 'D', D: 'U', L: 'R', R: 'L' };
  const KEYS = {
    ArrowUp: 'U', ArrowDown: 'D', ArrowLeft: 'L', ArrowRight: 'R',
    w: 'U', s: 'D', a: 'L', d: 'R', ' ': 'W',
  };

  /* ---------------------------------------------------------
     state
     --------------------------------------------------------- */
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d', { alpha: false });
  const audio = new A.AudioKit();
  const fx = new A.Particles(1000);

  const G = {
    room: 1, score: 0, lives: 3, turn: 0,
    grid: null, player: null, enemies: [],
    threat: null,               // Set of cell indices that will be hit next turn
    anim: 1, animFrom: null,
    status: 'title',            // title | play | dead | over
    time: 0, shake: 0, flash: 0,
    combo: 0,
    started: false,
    queued: null,
  };

  const idx = (x, y) => y * COLS + x;
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < COLS && y < ROWS;
  const tile = (x, y) => (inBounds(x, y) ? G.grid[idx(x, y)] : T_WALL);
  const isWall = (x, y) => tile(x, y) === T_WALL;
  const isPit = (x, y) => tile(x, y) === T_PIT;

  /* ---------------------------------------------------------
     room generation
     --------------------------------------------------------- */
  function makeRoom(n) {
    const rng = Rng('decoy|' + n + '|' + Store.get('dc:seed', 1));
    const grid = new Uint8Array(COLS * ROWS);
    for (let x = 0; x < COLS; x++) { grid[idx(x, 0)] = T_WALL; grid[idx(x, ROWS - 1)] = T_WALL; }
    for (let y = 0; y < ROWS; y++) { grid[idx(0, y)] = T_WALL; grid[idx(COLS - 1, y)] = T_WALL; }

    // a few interior blocks to break sight lines
    const blocks = 1 + Math.min(4, Math.floor(n / 3));
    for (let b = 0; b < blocks; b++) {
      const bx = rng.int(2, COLS - 4), by = rng.int(2, ROWS - 4);
      const bw = rng.int(1, 2), bh = rng.int(1, 2);
      for (let y = by; y < by + bh; y++) {
        for (let x = bx; x < bx + bw; x++) if (inBounds(x, y)) grid[idx(x, y)] = T_WALL;
      }
    }

    // pits — the only thing that guarantees a room can be cleared
    const pits = 5 + Math.min(7, Math.floor(n / 2));
    let guard = 0;
    let placed = 0;
    while (placed < pits && guard++ < 400) {
      const x = rng.int(2, COLS - 3), y = rng.int(2, ROWS - 3);
      if (grid[idx(x, y)] !== T_FLOOR) continue;
      // keep them from fusing into one impassable moat
      let touching = 0;
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        if (inBounds(x+dx, y+dy) && grid[idx(x+dx, y+dy)] === T_PIT) touching++;
      }
      if (touching > 1) continue;
      grid[idx(x, y)] = T_PIT;
      placed++;
    }

    G.grid = grid;

    // the player starts in a clear corner-ish spot
    let px = 1, py = ROWS - 2, tries = 0;
    while (tries++ < 200) {
      const x = rng.int(1, COLS - 2), y = rng.int(1, ROWS - 2);
      if (grid[idx(x, y)] === T_FLOOR) { px = x; py = y; break; }
    }
    G.player = { x: px, y: py, px, py };

    // composition: more, and nastier, as you go
    const pool = ['charger', 'charger', 'lancer'];
    if (n >= 3) pool.push('bomber');
    if (n >= 5) pool.push('mirror', 'lancer');
    if (n >= 8) pool.push('bomber', 'charger');
    const count = clamp(2 + Math.floor(n / 2), 2, 7);

    const enemies = [];
    guard = 0;
    while (enemies.length < count && guard++ < 700) {
      const kind = rng.pick(pool);
      const x = rng.int(1, COLS - 2), y = rng.int(1, ROWS - 2);
      if (grid[idx(x, y)] !== T_FLOOR) continue;
      if (Math.abs(x - px) + Math.abs(y - py) < 4) continue;
      if (enemies.some((e) => e.x === x && e.y === y)) continue;
      enemies.push(mkEnemy(kind, x, y, rng));
    }
    G.enemies = enemies;
    G.turn = 0;
    G.combo = 0;
    G.anim = 1;
    updateThreat();
  }

  function mkEnemy(kind, x, y, rng) {
    const e = { kind, x, y, px: x, py: y, dead: false, hue: KIND[kind].color };
    if (kind === 'lancer') { e.state = 'idle'; e.aim = null; }
    if (kind === 'bomber') e.fuse = rng ? rng.int(3, 5) : 4;
    return e;
  }

  /* ---------------------------------------------------------
     movement helpers
     --------------------------------------------------------- */
  // Greedy step toward the player. Deliberately blind to pits — that blindness
  // is the entire game.
  function stepToward(e) {
    const dx = G.player.x - e.x, dy = G.player.y - e.y;
    const order = Math.abs(dx) >= Math.abs(dy)
      ? [[Math.sign(dx), 0], [0, Math.sign(dy)]]
      : [[0, Math.sign(dy)], [Math.sign(dx), 0]];
    for (const [ox, oy] of order) {
      if (!ox && !oy) continue;
      const nx = e.x + ox, ny = e.y + oy;
      if (isWall(nx, ny)) continue;
      if (G.enemies.some((o) => o !== e && !o.dead && o.x === nx && o.y === ny)) continue;
      return { x: nx, y: ny };
    }
    return { x: e.x, y: e.y };
  }

  // Cells a lancer bolt would cover, firing from e along dir until it meets wall.
  function boltCells(e, dir) {
    const [dx, dy] = DIRS[dir];
    const out = [];
    let x = e.x + dx, y = e.y + dy;
    while (inBounds(x, y) && !isWall(x, y)) { out.push(idx(x, y)); x += dx; y += dy; }
    return out;
  }
  function blastCells(e) {
    const out = [];
    for (let y = e.y - 1; y <= e.y + 1; y++) {
      for (let x = e.x - 1; x <= e.x + 1; x++) {
        if (inBounds(x, y) && !isWall(x, y)) out.push(idx(x, y));
      }
    }
    return out;
  }

  // Everything that will be dangerous on the NEXT turn, so the player can see it.
  function updateThreat() {
    const t = new Set();
    for (const e of G.enemies) {
      if (e.dead) continue;
      if (e.kind === 'lancer' && e.state === 'aim') boltCells(e, e.aim).forEach((c) => t.add(c));
      if (e.kind === 'bomber' && e.fuse <= 0) blastCells(e).forEach((c) => t.add(c));
    }
    G.threat = t;
  }

  const alignedDir = (e) => {
    if (e.y === G.player.y) {
      const dir = G.player.x > e.x ? 'R' : 'L';
      const [dx] = DIRS[dir];
      for (let x = e.x + dx; x !== G.player.x; x += dx) if (isWall(x, e.y)) return null;
      return e.x === G.player.x ? null : dir;
    }
    if (e.x === G.player.x) {
      const dir = G.player.y > e.y ? 'D' : 'U';
      const [, dy] = DIRS[dir];
      for (let y = e.y + dy; y !== G.player.y; y += dy) if (isWall(e.x, y)) return null;
      return dir;
    }
    return null;
  };

  /* ---------------------------------------------------------
     the turn
     --------------------------------------------------------- */
  function act(cmd) {
    if (G.status !== 'play') return;
    if (G.anim < 1) { G.queued = cmd; return; }

    const p = G.player;
    p.px = p.x; p.py = p.y;
    G.enemies.forEach((e) => { e.px = e.x; e.py = e.y; });

    /* ---- 1. the player moves ---- */
    let moved = 'W';
    if (cmd !== 'W') {
      const [dx, dy] = DIRS[cmd];
      const nx = p.x + dx, ny = p.y + dy;
      if (!isWall(nx, ny)) { p.x = nx; p.y = ny; moved = cmd; }
      else {
        audio.noise({ dur: 0.06, gain: 0.05, type: 'lowpass', freq: 500, to: 180 });
        return;                                   // a bump costs no time
      }
    }
    G.turn++;

    // walking into a pit, or onto something with teeth
    if (isPit(p.x, p.y)) { die('you fell'); return; }
    if (G.enemies.some((e) => !e.dead && e.x === p.x && e.y === p.y)) { die('you walked into it'); return; }

    /* ---- 2. telegraphed attacks land first ---- */
    const hit = new Set();
    let shots = 0;
    for (const e of G.enemies) {
      if (e.dead) continue;
      if (e.kind === 'lancer' && e.state === 'aim') {
        boltCells(e, e.aim).forEach((c) => hit.add(c));
        e.state = 'idle'; e.aim = null;
        shots++;
        audio.tone({ freq: 900, to: 200, dur: 0.16, type: 'sawtooth', gain: 0.13 });
      } else if (e.kind === 'bomber' && e.fuse <= 0) {
        blastCells(e).forEach((c) => hit.add(c));
        e.dead = true; e.cause = 'blast';
        shots++;
        audio.noise({ dur: 0.4, gain: 0.24, type: 'lowpass', freq: 1600, to: 60 });
        audio.tone({ freq: 160, to: 50, dur: 0.4, type: 'square', gain: 0.14 });
        G.shake = 14;
      }
    }
    if (hit.size) {
      hit.forEach((c) => {
        const x = c % COLS, y = Math.floor(c / COLS);
        fx.burst(x * CELL + CELL / 2, y * CELL + CELL / 2, 5, {
          color: '#ffb0a0', r: 2.6, drag: 0.88, glow: 10,
          spdMin: 20, spdMax: 90, lifeMin: 0.15, lifeMax: 0.4 });
      });
    }

    /* ---- 3. everything that survived takes its turn ---- */
    for (const e of G.enemies) {
      if (e.dead) continue;
      if (hit.has(idx(e.x, e.y))) { e.dead = true; e.cause = 'friendly'; continue; }

      if (e.kind === 'charger') {
        const n = stepToward(e); e.x = n.x; e.y = n.y;
      } else if (e.kind === 'mirror') {
        if (moved !== 'W') {
          const [dx, dy] = DIRS[OPP[moved]];
          const nx = e.x + dx, ny = e.y + dy;
          if (!isWall(nx, ny) && !G.enemies.some((o) => o !== e && !o.dead && o.x === nx && o.y === ny)) {
            e.x = nx; e.y = ny;
          }
        }
      } else if (e.kind === 'lancer') {
        const dir = alignedDir(e);
        if (dir) { e.state = 'aim'; e.aim = dir; audio.tone({ freq: 380, to: 620, dur: 0.1, type: 'square', gain: 0.06 }); }
        else { const n = stepToward(e); e.x = n.x; e.y = n.y; }
      } else if (e.kind === 'bomber') {
        e.fuse--;
        if (e.fuse > 0) { const n = stepToward(e); e.x = n.x; e.y = n.y; }
        if (e.fuse === 1) audio.tone({ freq: 700, dur: 0.07, type: 'triangle', gain: 0.09 });
      }
    }

    /* ---- 4. the floor collects what walked into it ---- */
    let killed = 0;
    for (const e of G.enemies) {
      if (e.dead) { if (e.cause) killed += scoreKill(e); continue; }
      if (isPit(e.x, e.y)) { e.dead = true; e.cause = 'pit'; killed += scoreKill(e); }
      else if (hit.has(idx(e.x, e.y))) { e.dead = true; e.cause = 'friendly'; killed += scoreKill(e); }
    }

    /* ---- 5. did any of it reach you ---- */
    if (hit.has(idx(p.x, p.y))) { die(shots > 1 ? 'caught in the crossfire' : 'shot'); return; }
    if (G.enemies.some((e) => !e.dead && e.x === p.x && e.y === p.y)) { die('caught'); return; }

    G.anim = 0;
    updateThreat();
    paintHud();

    if (G.enemies.every((e) => e.dead)) clearRoom();
  }

  function scoreKill(e) {
    if (e.counted) return 0;
    e.counted = true;
    const base = e.cause === 'pit' ? 100 : 180;
    G.combo++;
    const pts = base * Math.min(5, G.combo);
    G.score += pts;
    fx.burst(e.x * CELL + CELL / 2, e.y * CELL + CELL / 2, 20, {
      color: e.hue, r: 3.2, drag: 0.9, glow: 14,
      spdMin: 30, spdMax: 190, lifeMin: 0.3, lifeMax: 0.8 });
    audio.tone({ freq: 420 + G.combo * 90, dur: 0.16, type: 'triangle', gain: 0.13, send: 0.3 });
    return pts;
  }

  function clearRoom() {
    const bonus = 250 + G.room * 60;
    G.score += bonus;
    G.flash = 0.45;
    toast('room clear  +' + bonus);
    audio.chord([440, 554, 659, 880], { dur: 0.7, type: 'triangle', gain: 0.13, spread: 0.05, send: 0.4 });
    G.room++;
    G.combo = 0;
    setTimeout(() => { if (G.status === 'play') { makeRoom(G.room); paintHud(); } }, 620);
  }

  function die(reason) {
    G.lives--;
    G.shake = 22;
    G.flash = 0.7;
    G.combo = 0;
    fx.burst(G.player.x * CELL + CELL / 2, G.player.y * CELL + CELL / 2, 40, {
      color: '#ffffff', r: 3.4, drag: 0.92, glow: 16,
      spdMin: 40, spdMax: 300, lifeMin: 0.4, lifeMax: 1.1 });
    audio.noise({ dur: 0.6, gain: 0.28, type: 'lowpass', freq: 1800, to: 70 });
    audio.tone({ freq: 200, to: 50, dur: 0.6, type: 'sawtooth', gain: 0.16 });
    toast(reason);
    paintHud();
    if (G.lives <= 0) { gameOver(); return; }
    G.status = 'dead';
    setTimeout(() => { makeRoom(G.room); G.status = 'play'; paintHud(); }, 900);
  }

  function gameOver() {
    G.status = 'over';
    const best = Store.get('dc:best', { score: 0, room: 0 });
    const isBest = G.score > best.score;
    if (isBest) Store.set('dc:best', { score: G.score, room: G.room });
    const $ = (id) => document.getElementById(id);
    $('overTitle').textContent = G.room > 1 ? `Cleared ${G.room - 1} room${G.room === 2 ? '' : 's'}` : 'Cleared nothing';
    $('overStats').innerHTML =
      `<div class="stat"><div class="v ${isBest ? 'good' : ''}">${G.score.toLocaleString()}</div><div class="k">score</div></div>` +
      `<div class="stat"><div class="v">${G.room - 1}</div><div class="k">rooms</div></div>` +
      `<div class="stat"><div class="v">${Math.max(best.score, G.score).toLocaleString()}</div><div class="k">best</div></div>`;
    $('overNote').textContent = isBest
      ? 'A new best. The floor did most of the work, as it should.'
      : 'They only go where you make them go.';
    setTimeout(() => show('ovOver'), 700);
  }

  /* ---------------------------------------------------------
     render
     --------------------------------------------------------- */
  function render() {
    const t = G.time;
    ctx.save();
    if (G.shake > 0.3) ctx.translate((Math.random() - 0.5) * G.shake, (Math.random() - 0.5) * G.shake);

    ctx.fillStyle = '#0a0706';
    ctx.fillRect(0, 0, VW, VH);
    if (!G.grid) { ctx.restore(); return; }

    /* ---- floor / walls / pits ---- */
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const px = x * CELL, py = y * CELL, tt = G.grid[idx(x, y)];
        if (tt === T_WALL) {
          ctx.fillStyle = '#3d2822';
          ctx.fillRect(px, py, CELL, CELL);
          ctx.fillStyle = 'rgba(255,170,140,0.30)';
          ctx.fillRect(px, py, CELL, 2.5);
          ctx.fillStyle = 'rgba(0,0,0,0.30)';
          ctx.fillRect(px, py + CELL - 3, CELL, 3);
        } else if (tt === T_PIT) {
          ctx.fillStyle = '#000';
          ctx.fillRect(px + 2, py + 2, CELL - 4, CELL - 4);
          const g = ctx.createRadialGradient(px + CELL / 2, py + CELL / 2, 2,
                                             px + CELL / 2, py + CELL / 2, CELL * 0.5);
          g.addColorStop(0, 'rgba(0,0,0,1)');
          g.addColorStop(1, 'rgba(60,30,25,0.55)');
          ctx.fillStyle = g;
          ctx.fillRect(px + 2, py + 2, CELL - 4, CELL - 4);
          ctx.strokeStyle = 'rgba(255,150,120,0.42)';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(px + 2.5, py + 2.5, CELL - 5, CELL - 5);
          // a lip, so a hole never reads as just a dark tile
          ctx.strokeStyle = 'rgba(0,0,0,0.85)';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(px + CELL / 2, py + CELL / 2, CELL * 0.30, 0, TAU);
          ctx.stroke();
        } else {
          ctx.fillStyle = '#1c1310';
          ctx.fillRect(px + 1, py + 1, CELL - 2, CELL - 2);
          ctx.strokeStyle = 'rgba(255,150,120,0.075)';
          ctx.lineWidth = 1;
          ctx.strokeRect(px + 1.5, py + 1.5, CELL - 3, CELL - 3);
        }
      }
    }

    /* ---- threat: what will be lethal on the next turn ---- */
    if (G.threat && G.threat.size) {
      const pulse = 0.28 + Math.sin(t * 7) * 0.12;
      ctx.save();
      G.threat.forEach((c) => {
        const x = (c % COLS) * CELL, y = Math.floor(c / COLS) * CELL;
        ctx.globalAlpha = pulse;
        ctx.fillStyle = '#ff2e46';
        ctx.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
        ctx.globalAlpha = pulse + 0.28;
        ctx.strokeStyle = '#ff6b7a';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let k = -CELL; k < CELL; k += 9) {
          ctx.moveTo(x + k, y + CELL); ctx.lineTo(x + k + CELL, y);
        }
        ctx.save(); ctx.beginPath();
        ctx.rect(x + 3, y + 3, CELL - 6, CELL - 6); ctx.clip();
        ctx.stroke(); ctx.restore();
      });
      ctx.restore();
    }

    /* ---- where you may step ---- */
    if (G.status === 'play' && G.anim >= 1) {
      for (const k in DIRS) {
        const [dx, dy] = DIRS[k];
        const nx = G.player.x + dx, ny = G.player.y + dy;
        if (isWall(nx, ny)) continue;
        ctx.save();
        ctx.globalAlpha = 0.13 + Math.sin(t * 3) * 0.04;
        ctx.strokeStyle = isPit(nx, ny) ? '#ff2e46' : '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(nx * CELL + 8.5, ny * CELL + 8.5, CELL - 17, CELL - 17);
        ctx.restore();
      }
    }

    const e01 = G.anim >= 1 ? 1 : G.anim * G.anim * (3 - 2 * G.anim);

    /* ---- enemies ---- */
    for (const e of G.enemies) {
      if (e.dead) continue;
      const ex = lerp(e.px, e.x, e01) * CELL + CELL / 2;
      const ey = lerp(e.py, e.y, e01) * CELL + CELL / 2;
      const s = CELL * 0.26;
      ctx.save();
      ctx.translate(ex, ey);
      ctx.shadowBlur = 14; ctx.shadowColor = e.hue;
      ctx.fillStyle = e.hue;

      if (e.kind === 'charger') {
        // a wedge pointing where it intends to go
        const n = stepToward(e);
        const ang = Math.atan2(n.y - e.y, n.x - e.x);
        ctx.rotate(isFinite(ang) ? ang : 0);
        ctx.beginPath();
        ctx.moveTo(s, 0); ctx.lineTo(-s * 0.75, s * 0.8); ctx.lineTo(-s * 0.4, 0);
        ctx.lineTo(-s * 0.75, -s * 0.8);
        ctx.closePath(); ctx.fill();
      } else if (e.kind === 'lancer') {
        A.roundRect(ctx, -s, -s, s * 2, s * 2, 4); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(10,6,5,0.8)';
        A.roundRect(ctx, -s + 4, -s + 4, s * 2 - 8, s * 2 - 8, 3); ctx.fill();
        ctx.fillStyle = e.hue;
        if (e.state === 'aim') {
          const [dx, dy] = DIRS[e.aim];
          ctx.fillRect(dx * s * 0.4 - 3, dy * s * 0.4 - 3, 6, 6);
          ctx.fillRect(dx * s - 2, dy * s - 2, 4, 4);
        } else {
          ctx.beginPath(); ctx.arc(0, 0, s * 0.26, 0, TAU); ctx.fill();
        }
      } else if (e.kind === 'bomber') {
        ctx.beginPath(); ctx.arc(0, 0, s, 0, TAU); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(10,6,5,0.82)';
        ctx.beginPath(); ctx.arc(0, 0, s - 4, 0, TAU); ctx.fill();
        ctx.fillStyle = e.fuse <= 0 ? '#fff' : e.hue;
        ctx.font = '700 15px ui-monospace, monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(Math.max(0, e.fuse)), 0, 1);
      } else {
        // mirror: two chevrons facing away from each other
        ctx.rotate(Math.PI / 4);
        A.roundRect(ctx, -s, -s, s * 2, s * 2, 4); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(10,6,5,0.8)';
        A.roundRect(ctx, -s + 4, -s + 4, s * 2 - 8, s * 2 - 8, 3); ctx.fill();
        ctx.rotate(-Math.PI / 4);
        ctx.fillStyle = e.hue;
        ctx.fillRect(-s * 0.55, -1.5, s * 1.1, 3);
      }
      ctx.restore();
    }

    /* ---- you ---- */
    const p = G.player;
    if (p && G.status !== 'over') {
      const px = lerp(p.px, p.x, e01) * CELL + CELL / 2;
      const py = lerp(p.py, p.y, e01) * CELL + CELL / 2;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(Math.PI / 4);
      ctx.shadowBlur = 18; ctx.shadowColor = '#fff';
      ctx.fillStyle = '#fff';
      const s = CELL * 0.21;
      A.roundRect(ctx, -s, -s, s * 2, s * 2, 3); ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = 0.28 + Math.sin(t * 4) * 0.1;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(px, py, CELL * 0.36, 0, TAU); ctx.stroke();
      ctx.restore();
    }

    fx.draw(ctx);

    if (G.flash > 0.01) {
      ctx.globalAlpha = G.flash * 0.5;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, VW, VH);
      ctx.globalAlpha = 1;
    }

    const vg = ctx.createRadialGradient(VW / 2, VH / 2, VH * 0.35, VW / 2, VH / 2, VH * 0.95);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.42)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, VW, VH);
    ctx.restore();
  }

  /* ---------------------------------------------------------
     HUD
     --------------------------------------------------------- */
  const $ = (id) => document.getElementById(id);
  let toastTimer = 0;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1200);
  }

  function paintHud() {
    $('hRoom').textContent = G.room;
    $('hScore').textContent = G.score.toLocaleString();
    $('hTurn').textContent = G.turn;
    const h = $('hHearts');
    h.innerHTML = '';
    for (let i = 0; i < 3; i++) {
      const d = document.createElement('div');
      d.className = 'heart' + (i < G.lives ? '' : ' gone');
      h.appendChild(d);
    }
    const seen = new Set(G.enemies.filter((e) => !e.dead).map((e) => e.kind));
    const leg = $('legend');
    leg.innerHTML = '';
    for (const k in KIND) {
      const d = document.createElement('div');
      d.className = 'leg' + (seen.has(k) ? ' on' : '');
      d.innerHTML = `<i style="background:${KIND[k].color}"></i>${KIND[k].label}`;
      leg.appendChild(d);
    }
  }

  function paintBestiary() {
    const dl = $('bestiary');
    dl.innerHTML = Object.keys(KIND).map((k) =>
      `<dt><i style="background:${KIND[k].color}"></i>${KIND[k].label}</dt><dd>${KIND[k].blurb}</dd>`
    ).join('') +
      `<dt><i style="background:#000;box-shadow:0 0 0 1px rgba(255,140,110,0.4)"></i>Pit</dt>` +
      `<dd>A hole. Anything that walks into one is gone — you included. Nothing in the ` +
      `room can see them, which makes them yours.</dd>`;
  }

  /* ---------------------------------------------------------
     flow + input
     --------------------------------------------------------- */
  const OVER = ['ovHelp', 'ovOver', 'ovStart'];
  const show = (id) => OVER.forEach((o) => { $(o).hidden = o !== id; });
  const hideAll = () => OVER.forEach((o) => { $(o).hidden = true; });
  const anyOverlay = () => OVER.some((o) => !$(o).hidden);

  function newRun() {
    Store.set('dc:seed', Math.floor(Math.random() * 1e6));
    G.room = 1; G.score = 0; G.lives = 3; G.combo = 0;
    G.status = 'play';
    fx.clear();
    makeRoom(1);
    paintHud();
    hideAll();
  }

  A.mountChrome(audio);
  paintBestiary();
  $('startBtn').addEventListener('click', () => {
    audio.unlock(); audio.setReverb(0.14);
    G.started = true;
    newRun();
  });
  $('helpBtn').addEventListener('click', () => show('ovHelp'));
  $('closeHelp').addEventListener('click', () => { if (G.started) hideAll(); else show('ovStart'); });
  $('againBtn').addEventListener('click', newRun);

  window.addEventListener('keydown', (ev) => {
    if (!G.started || anyOverlay()) return;
    const cmd = KEYS[ev.key];
    if (!cmd) return;
    ev.preventDefault();
    audio.unlock();
    act(cmd);
  });

  /* ---------------------------------------------------------
     loop
     --------------------------------------------------------- */
  let last = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const t = now / 1000;
    const dt = Math.min(0.05, last ? t - last : 0.016);
    last = t;
    G.time = t;
    G.shake = approach(G.shake, 0, 0.00002, dt);
    G.flash = approach(G.flash, 0, 0.0001, dt);
    fx.update(dt);
    if (G.anim < 1) {
      G.anim = Math.min(1, G.anim + dt / ANIM);
      if (G.anim >= 1 && G.queued) { const q = G.queued; G.queued = null; act(q); }
    }
    render();
  }

  ctx.fillStyle = '#0a0706';
  ctx.fillRect(0, 0, VW, VH);
  show('ovStart');
  requestAnimationFrame(frame);

  /* ---------------------------------------------------------
     debug hook
     --------------------------------------------------------- */
  window.__DC = {
    G, KIND, makeRoom, act, stepToward, boltCells, blastCells, updateThreat,
    consts: { COLS, ROWS, CELL, T_FLOOR, T_WALL, T_PIT },
    newRun,
    start() { G.started = true; G.status = 'play'; newRun(); },
    snapshot() {
      return {
        room: G.room, score: G.score, lives: G.lives, turn: G.turn, status: G.status,
        player: [G.player.x, G.player.y],
        enemies: G.enemies.filter((e) => !e.dead)
          .map((e) => ({ k: e.kind, x: e.x, y: e.y, fuse: e.fuse, state: e.state })),
        threat: [...(G.threat || [])],
        pits: [...G.grid].reduce((a, v, i) => (v === T_PIT ? (a.push(i), a) : a), []),
      };
    },
  };
})();
