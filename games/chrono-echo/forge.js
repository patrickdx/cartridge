/* ============================================================
   CHRONO ECHO — the Forge
   A level editor. Paint a board, test it instantly, and share it as a
   URL: the whole level is run-length encoded into the link, so there is
   nothing to host and nothing to sign into.
   ============================================================ */
(function () {
  'use strict';

  const CE = window.__CE;
  if (!CE) return;
  const A = window.Arcade;
  const { clamp, TAU } = A;
  const COLS = 32, ROWS = 18, TILE = 30;
  const { ctx, canvas, VW, VH } = CE;

  /* ---------------------------------------------------------
     brushes
     --------------------------------------------------------- */
  const BRUSHES = [
    { c: '#', label: 'Wall',      col: '#38477a', glyph: '█', hint: 'Solid ground.' },
    { c: '=', label: 'Thin',      col: '#4b5a97', glyph: '▔', hint: 'One-way platform — jump up through it, press down to drop.' },
    { c: '^', label: 'Spikes',    col: '#ff5470', glyph: '▲', hint: 'Ends the take.' },
    { c: 'S', label: 'Spawn',     col: '#5df2d6', glyph: '◉', hint: 'Where every take begins. Exactly one.' },
    { c: 'X', label: 'Exit',      col: '#5df2d6', glyph: '◎', hint: 'Opens once every orb is collected. Exactly one.' },
    { c: 'o', label: 'Orb',       col: '#ffcc55', glyph: '●', hint: 'Stays collected across takes.' },
    { c: '1', label: 'Pad 1',     col: '#5df2d6', glyph: '▬', hint: 'Held down by you or any echo. Opens door A.' },
    { c: '2', label: 'Pad 2',     col: '#ffcc55', glyph: '▬', hint: 'Opens door B.' },
    { c: '3', label: 'Pad 3',     col: '#ff6bd6', glyph: '▬', hint: 'Opens door C.' },
    { c: 'a', label: 'Door A',    col: '#5df2d6', glyph: '▮', hint: 'Solid until pad 1 is held.' },
    { c: 'b', label: 'Door B',    col: '#ffcc55', glyph: '▮', hint: 'Solid until pad 2 is held.' },
    { c: 'c', label: 'Door C',    col: '#ff6bd6', glyph: '▮', hint: 'Solid until pad 3 is held.' },
    { c: 'L', label: 'Beam',      col: '#ff5470', glyph: '◄', hint: 'Timed laser. Click it again to turn it; a fourth click removes it.' },
    { c: 'M', label: 'Lift',      col: '#6b9dff', glyph: '⇄', hint: 'Moving platform. Click the start, then the destination.' },
    { c: '.', label: 'Erase',     col: '#6b7280', glyph: '×', hint: 'Clears a cell, a beam or a lift.' },
  ];

  const blankRows = () => {
    const r = [];
    for (let y = 0; y < ROWS; y++) {
      let s = '';
      for (let x = 0; x < COLS; x++) {
        s += (y === 0 || y === ROWS - 1 || x === 0 || x === COLS - 1) ? '#' : '.';
      }
      r.push(s);
    }
    // a floor to stand on, and a spawn
    r[ROWS - 3] = '#'.repeat(COLS);
    r[ROWS - 2] = '#'.repeat(COLS);
    r[ROWS - 4] = '#..S' + '.'.repeat(COLS - 5) + '#';
    return r;
  };

  const ED = {
    open: false,
    rows: blankRows(),
    name: 'Untitled fracture',
    loops: 4, par: 2,
    lasers: [], movers: [],
    brush: '#',
    painting: 0,           // 0 none, 1 paint, 2 erase
    cx: -1, cy: -1,
    pendingMover: null,
    laserPeriod: 240, laserOn: 60,
    moverPeriod: 360, moverW: 3,
    dirty: true,
  };

  const setCell = (x, y, ch) => {
    if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return;
    const r = ED.rows[y];
    ED.rows[y] = r.slice(0, x) + ch + r.slice(x + 1);
  };
  const getCell = (x, y) =>
    (x < 0 || y < 0 || x >= COLS || y >= ROWS) ? '#' : ED.rows[y][x];

  function removeUnique(ch) {
    for (let y = 0; y < ROWS; y++) {
      const i = ED.rows[y].indexOf(ch);
      if (i >= 0) setCell(i, y, '.');
    }
  }

  /* ---------------------------------------------------------
     painting
     --------------------------------------------------------- */
  function paint(x, y, erase) {
    if (x < 1 || y < 1 || x >= COLS - 1 || y >= ROWS - 1) return; // keep the border
    const b = erase ? '.' : ED.brush;

    if (b === '.') {
      setCell(x, y, '.');
      ED.lasers = ED.lasers.filter((l) => !(l.x === x && l.y === y));
      ED.movers = ED.movers.filter((m) => !(m.x === x && m.y === y));
      ED.dirty = true;
      return;
    }
    if (b === 'L') {
      const ex = ED.lasers.find((l) => l.x === x && l.y === y);
      if (ex) {
        const order = ['r', 'd', 'l', 'u'];
        const i = order.indexOf(ex.dir);
        if (i === order.length - 1) ED.lasers = ED.lasers.filter((l) => l !== ex);
        else ex.dir = order[i + 1];
      } else {
        setCell(x, y, '.');
        ED.lasers.push({ x, y, dir: 'r', period: ED.laserPeriod, on: ED.laserOn, phase: 0 });
        restagger();
      }
      ED.dirty = true;
      return;
    }
    if (b === 'M') {
      if (!ED.pendingMover) {
        ED.pendingMover = { x, y };
      } else {
        const s = ED.pendingMover;
        ED.movers.push({
          x: s.x, y: s.y, w: ED.moverW,
          dx: x - s.x, dy: y - s.y,
          period: ED.moverPeriod, phase: 0,
        });
        ED.pendingMover = null;
      }
      ED.dirty = true;
      return;
    }
    if (b === 'S' || b === 'X') removeUnique(b);
    setCell(x, y, b);
    ED.lasers = ED.lasers.filter((l) => !(l.x === x && l.y === y));
    ED.dirty = true;
  }

  // Spread beam phases evenly so a freshly placed set of beams alternates
  // instead of all firing at once.
  function restagger() {
    const n = ED.lasers.length;
    ED.lasers.forEach((l, i) => {
      l.period = ED.laserPeriod;
      l.on = ED.laserOn;
      l.phase = Math.round((i * ED.laserPeriod) / Math.max(1, n));
    });
  }

  /* ---------------------------------------------------------
     level definition <-> editor state
     --------------------------------------------------------- */
  const toDef = () => ({
    name: ED.name || 'Untitled fracture',
    hint: 'A fracture someone made.',
    loops: ED.loops, par: ED.par,
    rows: ED.rows.slice(),
    lasers: ED.lasers.map((l) => Object.assign({}, l)),
    movers: ED.movers.map((m) => Object.assign({}, m)),
  });

  function fromDef(def) {
    ED.rows = def.rows.slice();
    ED.name = def.name || 'Untitled fracture';
    ED.loops = def.loops || 4;
    ED.par = def.par || 2;
    ED.lasers = (def.lasers || []).map((l) => Object.assign({}, l));
    ED.movers = (def.movers || []).map((m) => Object.assign({}, m));
    ED.dirty = true;
  }

  /* ---------------------------------------------------------
     share codes
     Tiles are remapped to letters first so run-lengths can use digits
     without colliding with the pad/door characters.
     --------------------------------------------------------- */
  const ENC = { '#':'W', '.':'.', '=':'T', '^':'K', 'S':'S', 'X':'X', 'o':'O',
                '1':'P', '2':'Q', '3':'R', 'a':'G', 'b':'H', 'c':'I' };
  const DEC = Object.fromEntries(Object.entries(ENC).map(([k, v]) => [v, k]));

  const b64 = (s) => btoa(unescape(encodeURIComponent(s)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64 = (s) => decodeURIComponent(escape(
    atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

  function encode() {
    const body = ED.rows.map((r) => [...r].map((c) => ENC[c] || '.').join('')).join('');
    let g = '', i = 0;
    while (i < body.length) {
      let j = i;
      while (j < body.length && body[j] === body[i]) j++;
      const n = j - i;
      g += body[i] + (n > 1 ? n : '');
      i = j;
    }
    return b64(JSON.stringify({
      v: 1, n: ED.name, l: ED.loops, p: ED.par, g,
      la: ED.lasers.map((l) => [l.x, l.y, l.dir, l.period, l.on, l.phase]),
      mv: ED.movers.map((m) => [m.x, m.y, m.w, m.dx, m.dy, m.period, m.phase]),
    }));
  }

  function decode(code) {
    const o = JSON.parse(unb64(code));
    let body = '';
    for (let i = 0; i < o.g.length;) {
      const ch = o.g[i++];
      let num = '';
      while (i < o.g.length && o.g[i] >= '0' && o.g[i] <= '9') num += o.g[i++];
      body += ch.repeat(num ? parseInt(num, 10) : 1);
    }
    if (body.length !== COLS * ROWS) throw new Error('bad length ' + body.length);
    const rows = [];
    for (let y = 0; y < ROWS; y++) {
      rows.push([...body.slice(y * COLS, (y + 1) * COLS)].map((c) => DEC[c] || '.').join(''));
    }
    return {
      name: o.n || 'Shared fracture', hint: 'A fracture someone made.',
      loops: o.l || 4, par: o.p || 2, rows,
      lasers: (o.la || []).map(([x, y, dir, period, on, phase]) => ({ x, y, dir, period, on, phase })),
      movers: (o.mv || []).map(([x, y, w, dx, dy, period, phase]) => ({ x, y, w, dx, dy, period, phase })),
    };
  }

  /* ---------------------------------------------------------
     validation
     --------------------------------------------------------- */
  function problems() {
    const flat = ED.rows.join('');
    const out = [];
    const count = (c) => (flat.split(c).length - 1);
    if (count('S') !== 1) out.push(count('S') === 0 ? 'No spawn placed.' : 'More than one spawn.');
    if (count('X') !== 1) out.push(count('X') === 0 ? 'No exit placed.' : 'More than one exit.');
    ['a', 'b', 'c'].forEach((g, i) => {
      if (count(g) > 0 && count(String(i + 1)) === 0) {
        out.push(`Door ${g.toUpperCase()} has no pad ${i + 1} to open it.`);
      }
    });
    if (count('o') > 30) out.push('More than 30 orbs.');
    if (ED.par > ED.loops) out.push('Par is higher than the take limit.');
    return out;
  }

  /* ---------------------------------------------------------
     rendering
     --------------------------------------------------------- */
  // Re-parsing and re-baking the board is expensive, so it only happens when
  // something actually changed; every other frame just blits the cached
  // snapshot and redraws the light overlay on top.
  const snap = document.createElement('canvas');
  snap.width = VW; snap.height = VH;
  const sctx = snap.getContext('2d');

  function draw() {
    if (!ED.open) return;
    if (ED.dirty) {
      try {
        CE.preview(toDef());
        sctx.clearRect(0, 0, VW, VH);
        sctx.drawImage(canvas, 0, 0);
        ED.dirty = false;
      } catch (e) { /* mid-edit, leave the last good snapshot up */ }
    }
    ctx.drawImage(snap, 0, 0);

    // grid
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.055)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= COLS; x++) { ctx.moveTo(x * TILE + 0.5, 0); ctx.lineTo(x * TILE + 0.5, VH); }
    for (let y = 0; y <= ROWS; y++) { ctx.moveTo(0, y * TILE + 0.5); ctx.lineTo(VW, y * TILE + 0.5); }
    ctx.stroke();

    // the frozen border you cannot paint into
    ctx.strokeStyle = 'rgba(93,242,214,0.16)';
    ctx.lineWidth = 2;
    ctx.strokeRect(TILE, TILE, VW - TILE * 2, VH - TILE * 2);

    // lift travel lines
    ctx.setLineDash([5, 6]);
    for (const m of ED.movers) {
      ctx.strokeStyle = 'rgba(107,157,255,0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo((m.x + m.w / 2) * TILE, m.y * TILE + 6);
      ctx.lineTo((m.x + m.dx + m.w / 2) * TILE, (m.y + m.dy) * TILE + 6);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // pending lift anchor
    if (ED.pendingMover) {
      const p = ED.pendingMover;
      ctx.strokeStyle = '#6b9dff';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(p.x * TILE + 2, p.y * TILE + 2, ED.moverW * TILE - 4, TILE - 4);
      ctx.setLineDash([]);
      if (ED.cx >= 0) {
        ctx.strokeStyle = 'rgba(107,157,255,0.5)';
        ctx.beginPath();
        ctx.moveTo((p.x + ED.moverW / 2) * TILE, p.y * TILE + TILE / 2);
        ctx.lineTo((ED.cx + ED.moverW / 2) * TILE, ED.cy * TILE + TILE / 2);
        ctx.stroke();
      }
    }

    // beam direction arrows
    for (const l of ED.lasers) {
      const cx = l.x * TILE + TILE / 2, cy = l.y * TILE + TILE / 2;
      const d = { r: [1, 0], l: [-1, 0], u: [0, -1], d: [0, 1] }[l.dir];
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.atan2(d[1], d[0]));
      ctx.fillStyle = '#ff5470';
      ctx.beginPath();
      ctx.moveTo(10, 0); ctx.lineTo(1, 5); ctx.lineTo(1, -5);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    // spawn marker — the preview has no player, so nothing else draws it
    for (let y = 0; y < ROWS; y++) {
      const sx = ED.rows[y].indexOf('S');
      if (sx < 0) continue;
      const px = sx * TILE + TILE / 2, py = y * TILE + TILE / 2;
      ctx.save();
      ctx.strokeStyle = '#5df2d6';
      ctx.lineWidth = 1.6;
      ctx.globalAlpha = 0.85;
      ctx.beginPath(); ctx.arc(px, py, 9, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = '#5df2d6';
      ctx.beginPath(); ctx.arc(px, py, 9, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = '#5df2d6';
      ctx.font = '600 8px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('START', px, py + 20);
      ctx.restore();
    }

    // cursor
    if (ED.cx >= 0 && ED.cy >= 0) {
      const inside = ED.cx >= 1 && ED.cy >= 1 && ED.cx < COLS - 1 && ED.cy < ROWS - 1;
      const br = BRUSHES.find((b) => b.c === ED.brush);
      ctx.strokeStyle = inside ? (br ? br.col : '#fff') : '#ff5470';
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.9;
      const w = (ED.brush === 'M' ? ED.moverW : 1) * TILE;
      ctx.strokeRect(ED.cx * TILE + 1, ED.cy * TILE + 1, w - 2, TILE - 2);
      ctx.globalAlpha = 0.14;
      ctx.fillStyle = br ? br.col : '#fff';
      ctx.fillRect(ED.cx * TILE + 1, ED.cy * TILE + 1, w - 2, TILE - 2);
    }
    ctx.restore();
  }

  /* ---------------------------------------------------------
     DOM
     --------------------------------------------------------- */
  const $ = (id) => document.getElementById(id);
  const root = document.createElement('div');
  root.id = 'forge';
  root.hidden = true;
  root.innerHTML = `
    <div class="forge-bar top">
      <div class="palette" id="fgPalette"></div>
    </div>
    <div class="forge-bar bottom">
      <label class="fg-field wide">
        <span>name</span>
        <input id="fgName" maxlength="40" value="Untitled fracture">
      </label>
      <label class="fg-field"><span>takes</span><input id="fgLoops" type="number" min="1" max="8" value="4"></label>
      <label class="fg-field"><span>par</span><input id="fgPar" type="number" min="1" max="8" value="2"></label>
      <label class="fg-field"><span>beam period</span><input id="fgLP" type="number" min="60" max="840" step="20" value="240"></label>
      <label class="fg-field"><span>beam on</span><input id="fgLO" type="number" min="10" max="400" step="10" value="60"></label>
      <label class="fg-field"><span>lift span</span><input id="fgMW" type="number" min="1" max="8" value="3"></label>
      <span class="fg-spacer"></span>
      <span class="fg-hint" id="fgHint"></span>
      <button class="fg-btn" id="fgTest">test</button>
      <button class="fg-btn" id="fgShare">copy link</button>
      <button class="fg-btn ghost" id="fgClear">clear</button>
      <button class="fg-btn ghost" id="fgExit">close</button>
    </div>`;

  function mount() {
    const frame = document.getElementById('frame');
    frame.appendChild(root);

    const pal = $('fgPalette');
    BRUSHES.forEach((b) => {
      const el = document.createElement('button');
      el.className = 'brush';
      el.dataset.c = b.c;
      el.style.setProperty('--bc', b.col);
      el.innerHTML = `<span class="g">${b.glyph}</span><span class="l">${b.label}</span>`;
      el.title = b.hint || b.label;
      el.addEventListener('click', () => {
        ED.brush = b.c;
        ED.pendingMover = null;
        paintPalette();
        $('fgHint').textContent = b.hint || '';
      });
      pal.appendChild(el);
    });
    paintPalette();

    const bind = (id, key, parse) => {
      $(id).addEventListener('input', (e) => {
        ED[key] = parse ? parse(e.target.value) : e.target.value;
        if (key === 'laserPeriod' || key === 'laserOn') restagger();
        ED.dirty = true;
      });
    };
    bind('fgName', 'name');
    bind('fgLoops', 'loops', (v) => clamp(parseInt(v, 10) || 1, 1, 8));
    bind('fgPar', 'par', (v) => clamp(parseInt(v, 10) || 1, 1, 8));
    bind('fgLP', 'laserPeriod', (v) => clamp(parseInt(v, 10) || 240, 60, 840));
    bind('fgLO', 'laserOn', (v) => clamp(parseInt(v, 10) || 60, 10, 400));
    bind('fgMW', 'moverW', (v) => clamp(parseInt(v, 10) || 3, 1, 8));

    $('fgTest').addEventListener('click', testPlay);
    $('fgShare').addEventListener('click', share);
    $('fgClear').addEventListener('click', () => {
      if (!confirm('Clear the board?')) return;
      ED.rows = blankRows(); ED.lasers = []; ED.movers = []; ED.pendingMover = null;
      ED.dirty = true;
    });
    $('fgExit').addEventListener('click', close);

    // painting
    const cellFrom = (e) => {
      const r = canvas.getBoundingClientRect();
      return {
        x: Math.floor((e.clientX - r.left) / r.width * COLS),
        y: Math.floor((e.clientY - r.top) / r.height * ROWS),
      };
    };
    canvas.addEventListener('pointerdown', (e) => {
      if (!ED.open) return;
      const c = cellFrom(e);
      ED.painting = e.button === 2 ? 2 : 1;
      paint(c.x, c.y, ED.painting === 2);
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!ED.open) return;
      const c = cellFrom(e);
      ED.cx = c.x; ED.cy = c.y;
      // drag-painting is only sensible for plain tiles
      if (ED.painting && !'LMSX'.includes(ED.brush)) paint(c.x, c.y, ED.painting === 2);
    });
    window.addEventListener('pointerup', () => { ED.painting = 0; });
    canvas.addEventListener('pointerleave', () => { ED.cx = -1; ED.cy = -1; });
    canvas.addEventListener('contextmenu', (e) => { if (ED.open) e.preventDefault(); });

    window.addEventListener('keydown', (e) => {
      if (/input|textarea/i.test((document.activeElement || {}).tagName || '')) return;
      if (e.key === 'Escape' && CE.G.custom && !ED.open) { reopen(); return; }
      if (!ED.open) return;
      const n = parseInt(e.key, 10);
      if (!isNaN(n) && n >= 1 && n <= 9) { ED.brush = BRUSHES[n - 1].c; paintPalette(); }
      if (e.key === 'e') { ED.brush = '.'; paintPalette(); }
      if (e.key === 't') testPlay();
    });

    // hook the render loop
    const raf = () => { requestAnimationFrame(raf); if (ED.open) draw(); };
    requestAnimationFrame(raf);
  }

  function paintPalette() {
    [...document.querySelectorAll('#fgPalette .brush')].forEach((el) => {
      el.classList.toggle('on', el.dataset.c === ED.brush);
    });
  }

  function syncFields() {
    $('fgName').value = ED.name;
    $('fgLoops').value = ED.loops;
    $('fgPar').value = ED.par;
    $('fgLP').value = ED.laserPeriod;
    $('fgLO').value = ED.laserOn;
    $('fgMW').value = ED.moverW;
  }

  /* ---------------------------------------------------------
     actions
     --------------------------------------------------------- */
  function testPlay() {
    const probs = problems();
    if (probs.length) { CE.toast(probs[0]); return; }
    ED.open = false;
    root.hidden = true;
    document.body.classList.remove('forging');
    CE.loadLevel(toDef());
    CE.toast('testing — esc returns to the forge');
  }

  function share() {
    const probs = problems();
    if (probs.length) { CE.toast(probs[0]); return; }
    const url = location.origin + location.pathname + '#f=' + encode();
    const done = () => CE.toast('link copied — ' + url.length + ' characters');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, () => {
        location.hash = 'f=' + encode();
        CE.toast('link is in the address bar');
      });
    } else {
      location.hash = 'f=' + encode();
      CE.toast('link is in the address bar');
    }
  }

  function open() {
    CE.G.started = true;
    ED.open = true;
    root.hidden = false;
    document.body.classList.add('forging');
    CE.hideAll();
    syncFields();
    paintPalette();
    ED.dirty = true;
  }
  function reopen() { open(); }
  function close() {
    ED.open = false;
    root.hidden = true;
    document.body.classList.remove('forging');
    CE.loadLevel(window.Arcade.Store.get('ce:last', 0));
  }

  /* ---------------------------------------------------------
     boot
     --------------------------------------------------------- */
  mount();

  window.CEForge = { open, close, reopen, encode, decode, fromDef, ED, toDef };

  // A shared level in the URL wins over everything else.
  function loadFromHash() {
    const m = location.hash.match(/^#f=(.+)$/);
    if (!m) return false;
    try {
      const def = decode(m[1]);
      fromDef(def);
      syncFields();
      // A stranger following the link should land in the game, not the editor —
      // but the board is loaded into the forge too, so Esc opens it for remixing.
      ED.open = false;
      root.hidden = true;
      document.body.classList.remove('forging');
      CE.G.started = true;
      CE.hideAll();
      CE.loadLevel(def);
      CE.toast(def.name + ' — esc to open it in the forge');
      return true;
    } catch (e) {
      CE.toast('that link is damaged');
      return false;
    }
  }
  window.CEForge.loadFromHash = loadFromHash;
  loadFromHash();
})();
