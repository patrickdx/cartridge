/* ============================================================
   LOCKSTEP
   One program. Every drone executes it at the same time.

   The whole game rests on one observation: an instruction is a
   function from squares to squares, and in open ground that function
   is a translation — injective, information preserving, and therefore
   incapable of ever bringing two drones together. Walls are the only
   thing that makes the map fold: a drone facing one stays put while
   its neighbour keeps coming. So every solution is, underneath, a
   synchronizing word for the board's automaton.
   ============================================================ */
(function () {
  'use strict';

  const A = window.Arcade;
  const { clamp, lerp, approach, TAU, Store } = A;

  /* ---------------------------------------------------------
     constants
     --------------------------------------------------------- */
  const COLS = 13, ROWS = 9, CELL = 52;
  const VW = COLS * CELL, VH = ROWS * CELL;   // 676 x 468

  const MOVES = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] };
  const GLYPH = { U: '↑', D: '↓', L: '←', R: '→' };
  const KEYMAP = {
    ArrowUp: 'U', ArrowDown: 'D', ArrowLeft: 'L', ArrowRight: 'R',
    w: 'U', s: 'D', a: 'L', d: 'R',
  };
  const DRONE_HUES = ['#a8ff60', '#52d9ff', '#ffc65c', '#ff8ad4', '#9d8bff'];

  /* ---------------------------------------------------------
     levels
       #  wall      .  floor
       o  drone     G  pad (all drones must gather here)
       *  crystal   (any drone may collect it)
     --------------------------------------------------------- */
  const LEVELS = [
    {
      name: 'Together', slots: 8, par: 3,
      brief: 'Two drones, one instruction each beat. The wall on the right does the rest.',
      rows: [
        '#############',
        '#...........#',
        '#...........#',
        '#...........#',
        '#.......o.oG#',
        '#...........#',
        '#...........#',
        '#...........#',
        '#############',
      ],
    },
    {
      name: 'Into the Corner', slots: 12, par: 7,
      brief: 'Nothing merges in open ground. Push everything into one corner.',
      rows: [
        '#############',
        '#G..........#',
        '#..o........#',
        '#...........#',
        '#....o......#',
        '#...........#',
        '#...........#',
        '#...........#',
        '#############',
      ],
    },
    {
      name: 'The Notch', slots: 18, par: 13,
      brief: 'A corner is not the only thing that folds. A single notch will do it.',
      rows: [
        '#############',
        '#...........#',
        '#..o....o...#',
        '#.....#.....#',
        '#....###....#',
        '#...........#',
        '#......G....#',
        '#...........#',
        '#############',
      ],
    },
    {
      name: 'Pillars', slots: 19, par: 14,
      brief: 'Two blocks, and a gap between them that only lets one drone through at a time.',
      rows: [
        '#############',
        '#..o........#',
        '#...........#',
        '#..###.###..#',
        '#....o.o....#',
        '#..###.###..#',
        '#...........#',
        '#.....G.....#',
        '#############',
      ],
    },
    {
      name: 'Off-Centre', slots: 20, par: 15,
      brief: 'The pad is nowhere near a corner. Gather first, then walk them over as one.',
      rows: [
        '#############',
        '#..o...o....#',
        '#...........#',
        '#....###....#',
        '#....#.#....#',
        '#.....o.....#',
        '#...........#',
        '#....G......#',
        '#############',
      ],
    },
    {
      name: 'Kernel', slots: 21, par: 16,
      brief: 'A crystal to collect on the way. Any drone may take it — only one has to.',
      rows: [
        '#############',
        '#...........#',
        '#..o........#',
        '#......*....#',
        '#....###....#',
        '#......o....#',
        '#...........#',
        '#G..........#',
        '#############',
      ],
    },
    {
      name: 'The Ledge', slots: 21, par: 16,
      brief: 'One long shelf across the middle, and a pad tucked underneath it.',
      rows: [
        '#############',
        '#...........#',
        '#.o.......o.#',
        '#...........#',
        '#..#######..#',
        '#.....G.....#',
        '#...........#',
        '#...........#',
        '#############',
      ],
    },
    {
      name: 'Collection', slots: 22, par: 17,
      brief: 'Two crystals in awkward places. Sweep them up before you gather.',
      rows: [
        '#############',
        '#..*........#',
        '#...........#',
        '#.o.........#',
        '#.......*...#',
        '#.....o.....#',
        '#...........#',
        '#G..........#',
        '#############',
      ],
    },
    {
      name: 'Pocket', slots: 25, par: 20,
      brief: 'The pad is inside the room. One way in, and everyone has to use it.',
      rows: [
        '#############',
        '#...........#',
        '#..#######..#',
        '#..#.....#..#',
        '#o.#..G..#.o#',
        '#..#.....#..#',
        '#..###.###..#',
        '#.....o.....#',
        '#############',
      ],
    },
    {
      name: 'Teeth', slots: 25, par: 20,
      brief: 'Staggered walls. Drones will catch on them one at a time, not all at once.',
      rows: [
        '#############',
        '#o..........#',
        '#####.#####.#',
        '#.....o.....#',
        '#.#####.#####',
        '#....o......#',
        '#.###.#####.#',
        '#......G....#',
        '#############',
      ],
    },
    {
      name: 'Sieve', slots: 28, par: 23,
      brief: 'Alcoves that hold a drone while the others move on. Three crystals, one pad.',
      rows: [
        '#############',
        '#*.#.....#.*#',
        '#..#.....#..#',
        '#..#..o..#..#',
        '#o.........o#',
        '#..#.....#..#',
        '#..#..*..#..#',
        '#G.#.....#..#',
        '#############',
      ],
    },
    {
      name: 'Lockstep', slots: 30, par: 25,
      brief: 'Four drones in four corners, two crystals, and a pad in the middle of it all.',
      rows: [
        '#############',
        '#o..#...#..o#',
        '#...#...#...#',
        '#.#.......#.#',
        '#....*.*....#',
        '#.#.......#.#',
        '#...#...#...#',
        '#o..#.G.#..o#',
        '#############',
      ],
    },
  ];

  /* ---------------------------------------------------------
     parsing
     --------------------------------------------------------- */
  function parse(def) {
    const wall = new Uint8Array(COLS * ROWS);
    const starts = [], crystals = [];
    let goal = null;
    for (let y = 0; y < ROWS; y++) {
      const row = def.rows[y] || '';
      for (let x = 0; x < COLS; x++) {
        const c = row[x] || '#';
        const i = y * COLS + x;
        if (c === '#') wall[i] = 1;
        else if (c === 'o') starts.push({ x, y });
        else if (c === 'G') goal = { x, y };
        else if (c === '*') crystals.push({ x, y });
      }
    }
    return { def, wall, starts, crystals, goal, name: def.name, slots: def.slots, brief: def.brief };
  }

  (function validate() {
    LEVELS.forEach((L, i) => {
      if (L.rows.length !== ROWS) console.warn(`level ${i} "${L.name}": ${L.rows.length} rows`);
      L.rows.forEach((r, y) => {
        if (r.length !== COLS) console.warn(`level ${i} "${L.name}" row ${y}: width ${r.length}`);
      });
      const flat = L.rows.join('');
      if ((flat.match(/G/g) || []).length !== 1) console.warn(`level ${i}: needs exactly one G`);
      if ((flat.match(/o/g) || []).length < 2) console.warn(`level ${i}: needs at least two drones`);
      if ((flat.match(/\*/g) || []).length > 30) console.warn(`level ${i}: too many crystals`);
    });
  })();

  /* ---------------------------------------------------------
     the machine
     --------------------------------------------------------- */
  // A single instruction applied to one square. Walls make this
  // non-injective, which is the only reason the puzzle is possible.
  function slide(lv, x, y, mv) {
    const [dx, dy] = MOVES[mv];
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) return { x, y };
    if (lv.wall[ny * COLS + nx]) return { x, y };
    return { x: nx, y: ny };
  }

  // Advance a whole configuration by one instruction.
  function stepConfig(lv, positions, mask, mv) {
    const out = [];
    let m = mask;
    for (const p of positions) {
      const n = slide(lv, p.x, p.y, mv);
      out.push(n);
      lv.crystals.forEach((c, ci) => {
        if (c.x === n.x && c.y === n.y) m |= (1 << ci);
      });
    }
    return { positions: out, mask: m };
  }

  const allGathered = (lv, positions, mask) =>
    positions.every((p) => p.x === lv.goal.x && p.y === lv.goal.y) &&
    mask === (1 << lv.crystals.length) - 1;

  /* ---------------------------------------------------------
     state
     --------------------------------------------------------- */
  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d', { alpha: false });
  const audio = new A.AudioKit();
  const fx = new A.Particles(700);

  const G = {
    idx: 0,
    lv: null,
    prog: [],
    // run state
    running: false,
    pc: 0,
    beat: 0,          // 0..1 progress through the current beat
    positions: [],
    prev: [],
    mask: 0,
    status: 'ready',  // ready | running | won | failed
    time: 0,
    shake: 0,
    started: false,
    progress: Store.get('ls:progress', {}),
  };

  const beatDuration = () => {
    const s = +document.getElementById('speed').value;
    return lerp(0.46, 0.07, (s - 1) / 9);
  };

  function resetRun() {
    const lv = G.lv;
    G.positions = lv.starts.map((s) => ({ x: s.x, y: s.y }));
    G.prev = G.positions.map((p) => ({ x: p.x, y: p.y }));
    G.mask = 0;
    // a drone standing on a crystal at t=0 has already taken it
    G.positions.forEach((p) => lv.crystals.forEach((c, ci) => {
      if (c.x === p.x && c.y === p.y) G.mask |= (1 << ci);
    }));
    G.pc = 0;
    G.beat = 1;
    G.running = false;
    G.status = 'ready';
    fx.clear();
    paintAll();
  }

  /* ---------------------------------------------------------
     execution
     --------------------------------------------------------- */
  function doStep() {
    if (G.status === 'won') return;
    if (G.pc >= G.prog.length) { finishRun(); return; }
    const mv = G.prog[G.pc];
    G.prev = G.positions.map((p) => ({ x: p.x, y: p.y }));
    const before = G.mask;
    const r = stepConfig(G.lv, G.positions, G.mask, mv);

    // anything that failed to move hit a wall — worth seeing and hearing
    let bumped = 0;
    r.positions.forEach((p, i) => {
      if (p.x === G.prev[i].x && p.y === G.prev[i].y) {
        bumped++;
        const [dx, dy] = MOVES[mv];
        fx.burst(p.x * CELL + CELL / 2 + dx * CELL * 0.4,
                 p.y * CELL + CELL / 2 + dy * CELL * 0.4, 5, {
          color: 'rgba(255,255,255,0.7)', r: 2.2, drag: 0.86, glow: 6,
          spdMin: 20, spdMax: 80, lifeMin: 0.14, lifeMax: 0.3 });
      }
    });

    G.positions = r.positions;
    G.mask = r.mask;
    G.pc++;
    G.beat = 0;

    if (bumped) audio.noise({ dur: 0.07, gain: 0.04 + bumped * 0.015, type: 'lowpass', freq: 900, to: 220 });
    audio.tone({ freq: 300 + (G.pc % 4) * 40, dur: 0.05, type: 'square', gain: 0.045 });

    // crystal chime
    if (r.mask !== before) {
      const n = countBits(r.mask);
      audio.tone({ freq: 720 * Math.pow(1.1892, n), dur: 0.3, type: 'triangle', gain: 0.16, send: 0.4 });
      G.lv.crystals.forEach((c, ci) => {
        if ((r.mask & (1 << ci)) && !(before & (1 << ci))) {
          fx.burst(c.x * CELL + CELL / 2, c.y * CELL + CELL / 2, 18, {
            color: '#52d9ff', r: 3, drag: 0.9, glow: 14,
            spdMin: 30, spdMax: 170, lifeMin: 0.3, lifeMax: 0.7 });
        }
      });
    }

    if (allGathered(G.lv, G.positions, G.mask)) { win(); return; }
    if (G.pc >= G.prog.length) finishRun();
    paintTape();
    paintStatusBits();
  }

  const countBits = (m) => { let n = 0; while (m) { n += m & 1; m >>= 1; } return n; };

  function finishRun() {
    G.running = false;
    if (G.status !== 'won') {
      G.status = 'failed';
      audio.tone({ freq: 220, to: 120, dur: 0.34, type: 'sawtooth', gain: 0.11 });
      paintStatusBits();
      paintControls();
    }
  }

  function win() {
    G.running = false;
    G.status = 'won';
    G.shake = 7;
    const used = G.prog.length;
    const par = G.lv.def.par;
    const prev = G.progress[G.idx];
    const best = prev && prev.len ? Math.min(prev.len, used) : used;
    G.progress[G.idx] = { done: true, len: best };
    Store.set('ls:progress', G.progress);

    const gx = G.lv.goal.x * CELL + CELL / 2, gy = G.lv.goal.y * CELL + CELL / 2;
    fx.burst(gx, gy, 46, { color: '#a8ff60', r: 3.4, drag: 0.92, glow: 16,
      spdMin: 40, spdMax: 260, lifeMin: 0.4, lifeMax: 1.1 });
    audio.chord([392, 523, 659, 784], { dur: 0.85, type: 'triangle', gain: 0.15, spread: 0.05, send: 0.5 });

    paintStatusBits();
    paintControls();

    const $ = (id) => document.getElementById(id);
    $('winTitle').textContent = G.lv.name;
    $('winStats').innerHTML =
      `<div class="stat"><div class="v ${par && used <= par ? 'good' : ''}">${used}</div><div class="k">instructions</div></div>` +
      (par ? `<div class="stat"><div class="v">${par}</div><div class="k">shortest known</div></div>` : '') +
      `<div class="stat"><div class="v">${best}</div><div class="k">your best</div></div>`;
    $('winNote').textContent = !par ? 'Solved.'
      : used < par ? 'Shorter than the shortest program I could find. Genuinely impressive.'
      : used === par ? 'That is the shortest program that exists for this board.'
      : `A ${par}-instruction program exists. There is a tighter fold in here somewhere.`;
    $('nextBtn').textContent = G.idx + 1 < LEVELS.length ? 'next board' : 'back to arcade';
    setTimeout(() => show('ovWin'), 620);
  }

  /* ---------------------------------------------------------
     rendering
     --------------------------------------------------------- */
  function render() {
    const t = G.time;
    ctx.save();
    if (G.shake > 0.2) ctx.translate((Math.random() - 0.5) * G.shake, (Math.random() - 0.5) * G.shake);

    ctx.fillStyle = '#05080c';
    ctx.fillRect(0, 0, VW, VH);
    const lv = G.lv;
    if (!lv) { ctx.restore(); return; }

    /* ---- floor + circuit traces ---- */
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (lv.wall[y * COLS + x]) continue;
        const px = x * CELL, py = y * CELL;
        ctx.fillStyle = '#070d13';
        ctx.fillRect(px + 1, py + 1, CELL - 2, CELL - 2);
        ctx.strokeStyle = 'rgba(82,217,255,0.055)';
        ctx.lineWidth = 1;
        ctx.strokeRect(px + 1.5, py + 1.5, CELL - 3, CELL - 3);
        ctx.fillStyle = 'rgba(82,217,255,0.10)';
        ctx.fillRect(px + CELL / 2 - 1, py + CELL / 2 - 1, 2, 2);
      }
    }

    /* ---- walls ---- */
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (!lv.wall[y * COLS + x]) continue;
        const px = x * CELL, py = y * CELL;
        ctx.fillStyle = '#1d2a3a';
        ctx.fillRect(px, py, CELL, CELL);
        // a little tooth of texture so a wall never reads as empty floor
        ctx.fillStyle = 'rgba(255,255,255,0.028)';
        ctx.fillRect(px + 6, py + 6, CELL - 12, CELL - 12);
        // light the faces that touch open floor
        const open = (ax, ay) =>
          ax >= 0 && ay >= 0 && ax < COLS && ay < ROWS && !lv.wall[ay * COLS + ax];
        ctx.fillStyle = 'rgba(82,217,255,0.42)';
        if (open(x, y - 1)) ctx.fillRect(px, py, CELL, 2);
        if (open(x, y + 1)) ctx.fillRect(px, py + CELL - 2, CELL, 2);
        if (open(x - 1, y)) ctx.fillRect(px, py, 2, CELL);
        if (open(x + 1, y)) ctx.fillRect(px + CELL - 2, py, 2, CELL);
      }
    }

    /* ---- the pad ---- */
    const gx = lv.goal.x * CELL + CELL / 2, gy = lv.goal.y * CELL + CELL / 2;
    const ready = G.mask === (1 << lv.crystals.length) - 1;
    ctx.save();
    const gcol = ready ? '#a8ff60' : '#4a6b3a';
    ctx.shadowBlur = ready ? 20 : 6; ctx.shadowColor = gcol;
    for (let r = 0; r < 2; r++) {
      const rad = CELL * (0.22 + r * 0.12);
      const spin = t * (ready ? 1.3 : 0.25) * (r % 2 ? -1 : 1);
      ctx.strokeStyle = gcol;
      ctx.globalAlpha = ready ? 0.95 - r * 0.28 : 0.5 - r * 0.16;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(gx, gy, rad, spin, spin + TAU * 0.7);
      ctx.stroke();
    }
    ctx.globalAlpha = ready ? 0.16 + Math.sin(t * 4) * 0.06 : 0.06;
    ctx.fillStyle = gcol;
    ctx.fillRect(lv.goal.x * CELL + 3, lv.goal.y * CELL + 3, CELL - 6, CELL - 6);
    ctx.restore();

    /* ---- crystals ---- */
    lv.crystals.forEach((c, ci) => {
      if (G.mask & (1 << ci)) return;
      const cx = c.x * CELL + CELL / 2, cy = c.y * CELL + CELL / 2;
      const s = CELL * 0.17 * (1 + Math.sin(t * 3 + ci) * 0.09);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(t * 1.1 + ci);
      ctx.shadowBlur = 16; ctx.shadowColor = '#52d9ff';
      ctx.fillStyle = '#52d9ff';
      ctx.beginPath();
      ctx.moveTo(0, -s); ctx.lineTo(s, 0); ctx.lineTo(0, s); ctx.lineTo(-s, 0);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#dff5ff';
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.4); ctx.lineTo(s * 0.4, 0); ctx.lineTo(0, s * 0.4); ctx.lineTo(-s * 0.4, 0);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    });

    /* ---- drones ---- */
    const e = G.beat >= 1 ? 1 : G.beat * G.beat * (3 - 2 * G.beat);
    // spread co-located drones a little so a stack is legible
    const key = (p) => p.x + ',' + p.y;
    const groups = {};
    G.positions.forEach((p, i) => { (groups[key(p)] = groups[key(p)] || []).push(i); });

    G.positions.forEach((p, i) => {
      const from = G.prev[i] || p;
      const px = lerp(from.x, p.x, e) * CELL + CELL / 2;
      const py = lerp(from.y, p.y, e) * CELL + CELL / 2;
      const g = groups[key(p)];
      const n = g.length, k = g.indexOf(i);
      const spread = n > 1 && G.beat >= 1 ? CELL * 0.10 : 0;
      const ang = n > 1 ? (k / n) * TAU : 0;
      const ox = Math.cos(ang) * spread, oy = Math.sin(ang) * spread;
      const col = DRONE_HUES[i % DRONE_HUES.length];
      const s = CELL * 0.29;

      ctx.save();
      ctx.translate(px + ox, py + oy);
      ctx.shadowBlur = 14; ctx.shadowColor = col;
      ctx.fillStyle = col;
      A.roundRect(ctx, -s, -s, s * 2, s * 2, 5);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(5,8,12,0.82)';
      A.roundRect(ctx, -s + 3.5, -s + 3.5, s * 2 - 7, s * 2 - 7, 3);
      ctx.fill();
      ctx.fillStyle = col;
      ctx.fillRect(-3, -3, 6, 6);
      ctx.restore();
    });

    // how many are stacked here
    Object.keys(groups).forEach((k2) => {
      const g = groups[k2];
      if (g.length < 2 || G.beat < 1) return;
      const [x, y] = k2.split(',').map(Number);
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = '600 11px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('×' + g.length, x * CELL + CELL / 2, y * CELL + CELL - 6);
      ctx.restore();
    });

    fx.draw(ctx);

    /* ---- scanlines ---- */
    ctx.save();
    ctx.globalAlpha = 0.035;
    ctx.fillStyle = '#000';
    for (let y = 0; y < VH; y += 3) ctx.fillRect(0, y, VW, 1);
    ctx.restore();

    ctx.restore();
  }

  /* ---------------------------------------------------------
     DOM
     --------------------------------------------------------- */
  const $ = (id) => document.getElementById(id);

  function paintAll() { paintTape(); paintStatusBits(); paintControls(); paintBrief(); }

  function paintTape() {
    const wrap = $('tape');
    const slots = G.lv.slots;
    if (wrap.children.length !== slots) {
      wrap.innerHTML = '';
      for (let i = 0; i < slots; i++) {
        const d = document.createElement('div');
        d.className = 'slot';
        d.setAttribute('role', 'listitem');
        d.addEventListener('click', () => {
          if (G.running) return;
          if (i < G.prog.length) { G.prog.splice(i, 1); resetRun(); }
        });
        wrap.appendChild(d);
      }
    }
    for (let i = 0; i < slots; i++) {
      const d = wrap.children[i];
      const has = i < G.prog.length;
      d.textContent = has ? GLYPH[G.prog[i]] : '';
      d.className = 'slot' + (has ? ' filled' : '')
        + (G.status !== 'ready' && i === G.pc && has ? ' pc' : '')
        + (G.status !== 'ready' && i < G.pc ? ' done' : '');
      d.title = has ? 'click to remove' : '';
    }
    const len = $('tapeLen');
    len.textContent = `${G.prog.length} / ${slots}`;
    len.classList.toggle('over', G.prog.length >= slots);
    const par = G.lv.def.par;
    const tag = $('parTag');
    tag.textContent = par ? `par ${par}` : 'par —';
    tag.classList.toggle('beat', !!par && G.prog.length > 0 && G.prog.length <= par);
  }

  function paintStatusBits() {
    const s = $('runStatus');
    s.textContent = G.status === 'ready' ? 'ready'
      : G.status === 'running' ? `beat ${G.pc}`
      : G.status === 'won' ? 'in lockstep'
      : 'out of instructions';
    s.className = 'status ' + (G.status === 'running' ? 'running'
      : G.status === 'won' ? 'won' : G.status === 'failed' ? 'failed' : '');

    const wrap = $('crystalTag');
    wrap.innerHTML = '';
    G.lv.crystals.forEach((_, ci) => {
      const d = document.createElement('div');
      d.className = 'cr-pip' + ((G.mask & (1 << ci)) ? ' taken' : '');
      wrap.appendChild(d);
    });
  }

  function paintControls() {
    const r = $('runBtn');
    r.textContent = G.running ? 'pause' : (G.status === 'ready' ? 'run' : 'resume');
    r.classList.toggle('stop', G.running);
    r.disabled = G.prog.length === 0 || G.status === 'won';
    $('stepBtn').disabled = G.prog.length === 0 || G.status === 'won';
  }

  function paintBrief() {
    $('lvNo').textContent = String(G.idx + 1).padStart(2, '0');
    $('lvName').textContent = G.lv.name;
    $('brief').innerHTML = G.lv.brief;
  }

  function push(mv) {
    if (G.running || G.status === 'won') return;
    if (G.prog.length >= G.lv.slots) { flashTape(); return; }
    G.prog.push(mv);
    if (G.status !== 'ready') resetRun(); else paintAll();
    audio.tone({ freq: 520, to: 640, dur: 0.05, type: 'triangle', gain: 0.05 });
  }
  function pop() {
    if (G.running || !G.prog.length) return;
    G.prog.pop();
    if (G.status !== 'ready') resetRun(); else paintAll();
    audio.tone({ freq: 420, to: 300, dur: 0.05, type: 'square', gain: 0.045 });
  }
  function flashTape() {
    const t = $('tape');
    t.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)' },
               { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }], { duration: 180 });
  }

  /* ---------------------------------------------------------
     flow
     --------------------------------------------------------- */
  const OVER = ['ovHelp', 'ovLevels', 'ovWin', 'ovStart'];
  const show = (id) => OVER.forEach((o) => { $(o).hidden = o !== id; });
  const hideAll = () => OVER.forEach((o) => { $(o).hidden = true; });
  const anyOverlay = () => OVER.some((o) => !$(o).hidden);

  function load(i, keepProg) {
    G.idx = clamp(i, 0, LEVELS.length - 1);
    G.lv = parse(LEVELS[G.idx]);
    if (!keepProg) G.prog = [];
    $('tape').innerHTML = '';
    resetRun();
    hideAll();
    Store.set('ls:last', G.idx);
  }

  function paintLevelGrid() {
    const grid = $('lvGrid');
    grid.innerHTML = '';
    LEVELS.forEach((L, i) => {
      const pr = G.progress[i];
      const unlocked = i === 0 || G.progress[i - 1];
      const b = document.createElement('button');
      b.className = 'lv-card' + (pr ? ' done' : '')
        + (pr && L.par && pr.len <= L.par ? ' perfect' : '') + (unlocked ? '' : ' locked');
      b.innerHTML =
        `<div class="n">${String(i + 1).padStart(2, '0')}</div>` +
        `<div class="nm">${unlocked ? L.name : '— locked —'}</div>` +
        `<div class="sc">${pr ? `best ${pr.len}${L.par ? ` · par ${L.par}` : ''}`
          : unlocked ? (L.par ? `par ${L.par}` : 'unsolved') : 'finish the last one'}</div>`;
      if (unlocked) b.addEventListener('click', () => { audio.unlock(); load(i); });
      grid.appendChild(b);
    });
  }

  /* ---------------------------------------------------------
     wiring
     --------------------------------------------------------- */
  A.mountChrome(audio);

  $('startBtn').addEventListener('click', () => {
    audio.unlock(); audio.setReverb(0.12);
    G.started = true;
    load(Store.get('ls:last', 0));
  });
  $('helpBtn').addEventListener('click', () => show('ovHelp'));
  $('closeHelp').addEventListener('click', () => { if (G.started) hideAll(); else show('ovStart'); });
  $('levelsBtn').addEventListener('click', () => { paintLevelGrid(); show('ovLevels'); });
  $('closeLevels').addEventListener('click', () => { if (G.started) hideAll(); else show('ovStart'); });
  $('wipeBtn').addEventListener('click', () => {
    Object.keys(G.progress).forEach((k) => delete G.progress[k]);
    Store.set('ls:progress', G.progress);
    paintLevelGrid();
  });
  $('retryBtn').addEventListener('click', () => { hideAll(); G.prog = []; resetRun(); });
  $('nextBtn').addEventListener('click', () => {
    if (G.idx + 1 < LEVELS.length) load(G.idx + 1);
    else window.location.href = '../../index.html';
  });

  $('runBtn').addEventListener('click', () => {
    audio.unlock();
    if (G.status === 'won') return;
    if (G.running) { G.running = false; G.status = 'running'; }
    else {
      if (G.status === 'failed' || G.pc >= G.prog.length) resetRun();
      G.running = true; G.status = 'running';
    }
    paintControls(); paintStatusBits();
  });
  $('stepBtn').addEventListener('click', () => {
    audio.unlock();
    if (G.status === 'failed' || G.pc >= G.prog.length) resetRun();
    G.running = false; G.status = 'running';
    doStep(); paintControls();
  });
  $('resetBtn').addEventListener('click', () => { resetRun(); });
  $('clearBtn').addEventListener('click', () => { G.prog = []; resetRun(); });

  const pal = $('palette');
  ['U', 'L', 'D', 'R'].forEach((mv) => {
    const b = document.createElement('button');
    b.className = 'pal';
    b.textContent = GLYPH[mv];
    b.title = { U: 'every drone tries to step up', D: 'every drone tries to step down',
                L: 'every drone tries to step left', R: 'every drone tries to step right' }[mv];
    b.addEventListener('click', () => { audio.unlock(); push(mv); });
    pal.appendChild(b);
  });

  window.addEventListener('keydown', (ev) => {
    if (!G.started || anyOverlay()) return;
    if (/input|textarea/i.test((document.activeElement || {}).tagName || '')) return;
    const mv = KEYMAP[ev.key];
    if (mv) { ev.preventDefault(); audio.unlock(); push(mv); return; }
    if (ev.key === 'Backspace') { ev.preventDefault(); pop(); }
    if (ev.key === 'Enter') { ev.preventDefault(); $('runBtn').click(); }
    if (ev.key === '.') { ev.preventDefault(); $('stepBtn').click(); }
    if (ev.key === 'r' || ev.key === 'R') resetRun();
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
    fx.update(dt);

    if (G.lv) {
      if (G.beat < 1) {
        G.beat = Math.min(1, G.beat + dt / beatDuration());
        if (G.beat >= 1) { paintTape(); paintStatusBits(); }
      } else if (G.running) {
        doStep();
        paintControls();
      }
      render();
    }
  }

  ctx.fillStyle = '#05080c';
  ctx.fillRect(0, 0, VW, VH);
  show('ovStart');
  requestAnimationFrame(frame);

  /* ---------------------------------------------------------
     debug hook — also hosts the optimal-solution search
     --------------------------------------------------------- */
  window.__LS = {
    G, LEVELS, parse, slide, stepConfig, allGathered, load,
    consts: { COLS, ROWS, CELL },
    setProgram(str) { G.prog = str.split('').filter((c) => MOVES[c]); resetRun(); },
    runToEnd() {
      resetRun();
      G.status = 'running';
      let guard = 0;
      while (G.pc < G.prog.length && G.status === 'running' && guard++ < 500) doStep();
      return { status: G.status, pc: G.pc,
               positions: G.positions.map((p) => [p.x, p.y]), mask: G.mask };
    },
    state() {
      return { level: G.lv && G.lv.name, idx: G.idx, prog: G.prog.join(''),
               status: G.status, pc: G.pc, mask: G.mask,
               drones: G.positions.length, crystals: G.lv ? G.lv.crystals.length : 0 };
    },

    // Breadth-first search over configurations. A configuration is the SET of
    // occupied squares plus the crystal mask; because every drone obeys the
    // same instruction, the whole board is one deterministic automaton and the
    // shortest program is just the shortest path to a gathered state.
    solve(levelIndex, maxDepth = 26, maxStates = 900000) {
      const lv = parse(LEVELS[levelIndex]);
      const full = (1 << lv.crystals.length) - 1;
      const enc = (ps, mask) => {
        const seen = new Set();
        for (const p of ps) seen.add(p.y * COLS + p.x);
        return [...seen].sort((a, b) => a - b).join(',') + '|' + mask;
      };
      let frontier = [{ ps: lv.starts.map((s) => ({ x: s.x, y: s.y })), mask: 0, path: '' }];
      // crystals under a starting drone count immediately
      frontier[0].ps.forEach((p) => lv.crystals.forEach((c, ci) => {
        if (c.x === p.x && c.y === p.y) frontier[0].mask |= (1 << ci);
      }));
      if (allGathered(lv, frontier[0].ps, frontier[0].mask)) return { len: 0, path: '' };
      const seen = new Set([enc(frontier[0].ps, frontier[0].mask)]);
      let states = 1;
      for (let d = 1; d <= maxDepth; d++) {
        const next = [];
        for (const node of frontier) {
          for (const mv of ['U', 'D', 'L', 'R']) {
            const r = stepConfig(lv, node.ps, node.mask, mv);
            const k = enc(r.positions, r.mask);
            if (seen.has(k)) continue;
            if (allGathered(lv, r.positions, r.mask)) {
              return { len: d, path: node.path + mv, states, depth: d };
            }
            seen.add(k);
            states++;
            if (states > maxStates) return { error: 'state cap', states, depth: d };
            next.push({ ps: r.positions, mask: r.mask, path: node.path + mv });
          }
        }
        if (!next.length) return { error: 'exhausted', states, depth: d };
        frontier = next;
      }
      return { error: 'depth cap', states };
    },
  };
})();
