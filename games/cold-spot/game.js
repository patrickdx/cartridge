/* ============================================================
   COLD SPOT
   A deduction game. Something is in the house, in exactly one room.

   Every instrument returns an honest partial truth. The interesting
   part is the engine underneath: readings are stored as predicates over
   grid positions, and the set of rooms still consistent with all of
   them is recomputed from scratch each time. Once the presence starts
   MOVING, a single set is no longer enough — the game keeps a set per
   time step and runs a forward/backward consistency pass over them,
   which is what makes "where could it be now" answerable at all.
   ============================================================ */
(function () {
  'use strict';

  const A = window.Arcade;
  const { clamp, lerp, TAU, Store, Rng } = A;
  const audio = new A.AudioKit();

  /* ---------------------------------------------------------
     content
     --------------------------------------------------------- */
  const HOUSES = [
    'Ashcombe', 'Thornfield', 'Marrowgate', 'Blackmere', 'Wrenholt',
    'Coldharbour', 'Fenwick Hall', 'Straydown', 'Hollowmoor', 'Greyfriars',
    'Netherby', 'Ravensworth', 'Duncrag', 'Immerlee', 'Sablewood',
  ];

  const ROOM_NAMES = [
    'Parlour', 'Study', 'Library', 'Conservatory', 'Cellar', 'Attic',
    'Kitchen', 'Scullery', 'Nursery', 'Ballroom', 'Chapel', 'Larder',
    'Gallery', 'Billiard Room', 'Morning Room', 'Boot Room', 'Linen Room',
    'Ice House', 'Observatory', 'Smoking Room', 'Music Room', 'Pantry',
    'Wine Cellar', "Servants' Hall", 'Drawing Room', 'Long Gallery',
    'Orangery', 'Bell Tower', 'Coal Store', 'Dark Room', 'Still Room',
    'Gun Room', 'Bath House', 'Map Room', 'Winter Garden', 'Cloister',
  ];

  const ICONS = {
    hearth: '<path d="M8 1.6c1.9 2.7 0 3.7.6 5.1.5-.6.9-1.4 1-2.2 1.7 1.5 2.5 3.3 2.5 5.2a4.1 4.1 0 0 1-8.2 0c0-2.7 1.8-5.1 4.1-8.1z"/>',
    glass:  '<path d="M2.6 2.6h10.8v10.8H2.6z"/><path d="M8 2.6v10.8M2.6 8h10.8"/>',
    timber: '<path d="M2 4.5h12M2 8h12M2 11.5h12"/>',
    damp:   '<path d="M8 2.2c2.6 3.2 4 5.3 4 7a4 4 0 0 1-8 0c0-1.7 1.4-3.8 4-7z"/>',
  };
  const ATTRS = [
    { key: 'hearth', label: 'a fireplace',      short: 'fireplace' },
    { key: 'glass',  label: 'a window or glass', short: 'glass' },
    { key: 'timber', label: 'bare floorboards',  short: 'floorboards' },
    { key: 'damp',   label: 'damp in the walls', short: 'damp' },
  ];
  const svg = (d, cls) =>
    `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" ` +
    `stroke-linejoin="round" stroke-linecap="round"${cls ? ` class="${cls}"` : ''}>${d}</svg>`;

  const TOOLS = {
    thermo: {
      name: 'Thermometer', cost: 2, target: 'room',
      blurb: 'exact distance',
      icon: '<path d="M6.4 9.6V3.2a1.6 1.6 0 0 1 3.2 0v6.4a3.2 3.2 0 1 1-3.2 0z"/><path d="M8 6.5v3.9"/>',
      help: 'Probe a room. It reports exactly how many rooms lie between there and the presence — diagonal steps count as one.',
    },
    compass: {
      name: 'EMF Compass', cost: 2, target: 'room',
      blurb: 'bearing',
      icon: '<circle cx="8" cy="8" r="6"/><path d="M10.4 5.6 6.9 6.9 5.6 10.4l3.5-1.3z"/>',
      help: 'Probe a room. The needle swings toward the presence and holds one of eight bearings. It spins if you probe the room it is in.',
    },
    dowse: {
      name: 'Dowsing Rod', cost: 1, target: 'line',
      blurb: 'row or column',
      icon: '<path d="M8 14V8"/><path d="M8 8 4 3.2"/><path d="m8 8 4-4.8"/>',
      help: 'Dragged along one corridor — a whole row or a whole column. It twitches if the presence lies anywhere along it.',
    },
    seance: {
      name: 'Séance', cost: 1, target: 'attr',
      blurb: 'one question',
      icon: '<circle cx="8" cy="8" r="2.2"/><path d="M8 1.6v2M8 12.4v2M1.6 8h2M12.4 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M12.5 3.5l-1.4 1.4M4.9 11.1 3.5 12.5"/>',
      help: 'Ask one yes-or-no question about the room it haunts — whether that room has a fireplace, glass, floorboards or damp.',
    },
  };

  /* ---------------------------------------------------------
     case shape by difficulty
     --------------------------------------------------------- */
  function caseSpec(n) {
    if (n <= 2) return { cols: 4, rows: 3, budget: 5, moving: false };
    if (n <= 5) return { cols: 5, rows: 4, budget: 6, moving: false };
    if (n <= 7) return { cols: 5, rows: 4, budget: 7, moving: true, moveEvery: 2 };
    if (n <= 10) return { cols: 6, rows: 4, budget: 8, moving: true, moveEvery: 2 };
    return { cols: 6, rows: 5, budget: 9, moving: true, moveEvery: 2 };
  }

  /* ---------------------------------------------------------
     state
     --------------------------------------------------------- */
  const G = {
    caseNo: 1,
    C: null,
    armed: null,          // tool key currently armed
    committing: false,
    over: false,
    stats: Store.get('cs:stats', { solved: 0, failed: 0, streak: 0, bestStreak: 0, score: 0 }),
  };

  /* ---------------------------------------------------------
     case generation
     --------------------------------------------------------- */
  function makeCase(n, seed) {
    const sp = caseSpec(n);
    const rng = Rng('cs|' + n + '|' + seed);
    const N = sp.cols * sp.rows;

    const names = rng.shuffle(ROOM_NAMES).slice(0, N);
    const rooms = names.map((nm) => ({ name: nm, attrs: {} }));

    // Give every attribute a roughly even split so a Séance is always worth
    // asking — an attribute that is true everywhere tells you nothing.
    for (const a of ATTRS) {
      const want = Math.round(N * rng.range(0.38, 0.62));
      const idx = rng.shuffle(rooms.map((_, i) => i)).slice(0, want);
      rooms.forEach((r, i) => { r.attrs[a.key] = idx.includes(i); });
    }

    // truth: a start room, and a walk if this case moves
    const path = [rng.int(0, N - 1)];
    const maxSteps = Math.ceil(sp.budget / (sp.moveEvery || 1)) + 2;
    for (let t = 1; t <= maxSteps; t++) {
      const nb = orthNeighbors(path[t - 1], sp.cols, sp.rows);
      path.push(rng.pick(nb));
    }

    return {
      n, ...sp, moveEvery: sp.moveEvery || Infinity,
      house: HOUSES[Math.floor(rng() * HOUSES.length)],
      rooms, path, N,
      readings: [], charges: sp.budget,
      marks: new Array(N).fill(0),   // 0 none, 1 ruled out, 2 suspect
      probed: new Array(N).fill(false),
      assist: document.getElementById('assistToggle').checked,
      usedAssist: false,
    };
  }

  const xy = (i, cols) => [i % cols, Math.floor(i / cols)];
  function orthNeighbors(i, cols, rows) {
    const [x, y] = xy(i, cols);
    const out = [];
    if (x > 0) out.push(i - 1);
    if (x < cols - 1) out.push(i + 1);
    if (y > 0) out.push(i - cols);
    if (y < rows - 1) out.push(i + cols);
    return out;
  }

  /* ---------------------------------------------------------
     the constraint engine
     --------------------------------------------------------- */
  // Does room `idx` satisfy this reading, considered as a statement about
  // where the presence was at the reading's time step?
  function satisfies(r, idx, C) {
    const [cx, cy] = xy(idx, C.cols);
    if (r.tool === 'thermo') {
      const [tx, ty] = xy(r.target, C.cols);
      return Math.max(Math.abs(cx - tx), Math.abs(cy - ty)) === r.result;
    }
    if (r.tool === 'compass') {
      const [tx, ty] = xy(r.target, C.cols);
      return (Math.sign(cx - tx) + ',' + Math.sign(cy - ty)) === r.result;
    }
    if (r.tool === 'dowse') {
      const on = r.axis === 'row' ? cy === r.index : cx === r.index;
      return on === r.result;
    }
    if (r.tool === 'seance') {
      return !!C.rooms[idx].attrs[r.attr] === r.result;
    }
    return true;
  }

  function expand(set, C) {
    const out = new Uint8Array(C.N);
    for (let i = 0; i < C.N; i++) {
      if (!set[i]) continue;
      for (const j of orthNeighbors(i, C.cols, C.rows)) out[j] = 1;
    }
    return out;
  }

  // Rooms the presence could be in RIGHT NOW, given every reading so far.
  // With a static presence this is one intersection. With a moving one it is a
  // forward pass (what is reachable and consistent) followed by a backward pass
  // (what could still have led to a consistent present).
  function candidates(C, readings) {
    readings = readings || C.readings;
    const steps = C.moving ? Math.floor(readings.length / C.moveEvery) : 0;

    const S = [];
    for (let t = 0; t <= steps; t++) {
      const set = new Uint8Array(C.N).fill(1);
      for (const r of readings) {
        if (r.t !== t) continue;
        for (let i = 0; i < C.N; i++) if (set[i] && !satisfies(r, i, C)) set[i] = 0;
      }
      S.push(set);
    }
    if (steps === 0) return S[0];

    const F = [S[0]];
    for (let t = 1; t <= steps; t++) {
      const e = expand(F[t - 1], C);
      const out = new Uint8Array(C.N);
      for (let i = 0; i < C.N; i++) out[i] = (e[i] && S[t][i]) ? 1 : 0;
      F.push(out);
    }
    const B = new Array(steps + 1);
    B[steps] = F[steps];
    for (let t = steps - 1; t >= 0; t--) {
      const e = expand(B[t + 1], C);
      const out = new Uint8Array(C.N);
      for (let i = 0; i < C.N; i++) out[i] = (F[t][i] && e[i]) ? 1 : 0;
      B[t] = out;
    }
    return B[steps];
  }

  const countSet = (s) => { let n = 0; for (let i = 0; i < s.length; i++) if (s[i]) n++; return n; };

  /* ---------------------------------------------------------
     taking a reading
     --------------------------------------------------------- */
  const currentT = (C) => (C.moving ? Math.floor(C.readings.length / C.moveEvery) : 0);
  const truthNow = (C) => C.path[currentT(C)];

  function readingResult(tool, spec, C) {
    const g = truthNow(C);
    const [gx, gy] = xy(g, C.cols);
    if (tool === 'thermo') {
      const [tx, ty] = xy(spec.target, C.cols);
      return Math.max(Math.abs(gx - tx), Math.abs(gy - ty));
    }
    if (tool === 'compass') {
      const [tx, ty] = xy(spec.target, C.cols);
      return Math.sign(gx - tx) + ',' + Math.sign(gy - ty);
    }
    if (tool === 'dowse') {
      return spec.axis === 'row' ? gy === spec.index : gx === spec.index;
    }
    if (tool === 'seance') return !!C.rooms[g].attrs[spec.attr];
  }

  const BEARINGS = {
    '0,-1': 'due north', '1,-1': 'north-east', '1,0': 'due east', '1,1': 'south-east',
    '0,1': 'due south', '-1,1': 'south-west', '-1,0': 'due west', '-1,-1': 'north-west',
    '0,0': 'spins — it is here',
  };

  function describe(r, C) {
    const nm = (i) => `<b>${C.rooms[i].name}</b>`;
    if (r.tool === 'thermo') {
      return `Thermometer at ${nm(r.target)} — <span class="res">${
        r.result === 0 ? 'reads zero. It is in this room' :
        r.result === 1 ? '1 room away' : r.result + ' rooms away'}</span>.`;
    }
    if (r.tool === 'compass') {
      return `Compass at ${nm(r.target)} — <span class="res">${BEARINGS[r.result]}</span>.`;
    }
    if (r.tool === 'dowse') {
      const where = r.axis === 'row' ? `row ${r.index + 1}` : `column ${r.index + 1}`;
      return `Dowsing rod along <b>${where}</b> — <span class="res">${
        r.result ? 'it twitches' : 'nothing'}</span>.`;
    }
    const a = ATTRS.find((x) => x.key === r.attr);
    return `Séance — “does it have ${a.label}?” <span class="res">${r.result ? 'Yes' : 'No'}</span>.`;
  }

  function takeReading(tool, spec) {
    const C = G.C;
    const cost = TOOLS[tool].cost;
    if (G.over || C.charges < cost) return;

    const t = currentT(C);
    const before = countSet(candidates(C));
    const result = readingResult(tool, spec, C);
    const r = Object.assign({ tool, t, result }, spec);
    C.readings.push(r);
    C.charges -= cost;
    if (spec.target != null) C.probed[spec.target] = true;

    const movedNow = C.moving && C.readings.length % C.moveEvery === 0;

    // sound: a chime whose pitch tracks how much the reading actually narrowed things
    const after = countSet(candidates(C));
    const gain = before > 0 ? 1 - after / before : 0;
    audio.tone({ freq: 380 + gain * 520, to: 300 + gain * 400, dur: 0.5, type: 'sine', gain: 0.13, send: 0.6 });
    audio.noise({ dur: 0.35, gain: 0.05, type: 'bandpass', freq: 1800, to: 500, q: 3 });

    G.armed = null;
    paintAll();
    if (spec.target != null) pingRoom(spec.target);
    if (movedNow) {
      setTimeout(() => {
        audio.noise({ dur: 0.7, gain: 0.11, type: 'lowpass', freq: 400, to: 120, q: 2 });
        audio.tone({ freq: 90, to: 62, dur: 0.8, type: 'sawtooth', gain: 0.07 });
        paintLog();
        coldPulse();
      }, 420);
    }
  }

  /* ---------------------------------------------------------
     committing
     --------------------------------------------------------- */
  function commit(idx) {
    const C = G.C;
    if (G.over) return;
    G.over = true;
    G.committing = false;
    document.body.classList.remove('arm-commit', 'arm-room', 'arm-dowse');

    const truth = truthNow(C);
    const right = idx === truth;
    const st = G.stats;

    let gained = 0;
    if (right) {
      gained = 600 + 120 * C.charges;
      if (C.usedAssist) gained = Math.round(gained / 2);
      gained = Math.round(gained * (1 + Math.min(1.2, st.streak * 0.15)));
      st.solved++; st.streak++;
      st.bestStreak = Math.max(st.bestStreak, st.streak);
      st.score += gained;
      audio.chord([392, 494, 587, 784], { dur: 1.1, type: 'triangle', gain: 0.13, spread: 0.07, send: 0.7 });
    } else {
      st.failed++; st.streak = 0;
      audio.tone({ freq: 150, to: 55, dur: 1.2, type: 'sawtooth', gain: 0.2 });
      audio.noise({ dur: 1.0, gain: 0.2, type: 'lowpass', freq: 900, to: 70, q: 1.5 });
    }
    Store.set('cs:stats', st);

    // reveal
    const cells = document.querySelectorAll('.room');
    cells[truth].classList.add('presence');
    if (!right) cells[idx].classList.add('wrongpick');
    coldPulse();
    paintStatus();

    const cand = countSet(candidates(C));
    setTimeout(() => {
      const $ = (id) => document.getElementById(id);
      $('resKicker').textContent = right ? 'Case closed' : 'Case lost';
      $('resKicker').className = 'kicker' + (right ? '' : ' bad');
      $('resTitle').textContent = right
        ? `It was in the ${C.rooms[truth].name}.`
        : `It was in the ${C.rooms[truth].name}, not the ${C.rooms[idx].name}.`;
      $('resNote').textContent = right
        ? (cand === 1
            ? 'Fully determined before you called it. That is the clean way to do it.'
            : `${cand} rooms still fitted your readings. You guessed well.`)
        : (cand === 1
            ? 'Your readings had already ruled that room out.'
            : `${cand} rooms still fitted your readings — the odds were against you.`);
      $('resStats').innerHTML =
        `<div class="stat"><div class="v ${right ? 'good' : ''}">${right ? '+' + gained.toLocaleString() : '0'}</div><div class="k">this case</div></div>` +
        `<div class="stat"><div class="v">${st.score.toLocaleString()}</div><div class="k">total</div></div>` +
        `<div class="stat"><div class="v">${st.streak}</div><div class="k">streak</div></div>` +
        `<div class="stat"><div class="v">${st.bestStreak}</div><div class="k">best streak</div></div>`;
      $('nextBtn').textContent = right ? 'next case' : 'try another house';
      show('ovResult');
    }, 1500);
  }

  /* ---------------------------------------------------------
     rendering
     --------------------------------------------------------- */
  const $ = (id) => document.getElementById(id);

  function paintAll() { paintStatus(); paintGrid(); paintTools(); paintLog(); paintPrompt(); }

  function paintStatus() {
    const C = G.C;
    $('sCase').textContent = C.n;
    $('sHouse').textContent = C.house;
    const pips = [];
    for (let i = 0; i < C.budget; i++) {
      pips.push(`<span class="charge-pip${i < C.charges ? '' : ' spent'}"></span>`);
    }
    $('sCharges').innerHTML = pips.join('');
    $('sScore').textContent = G.stats.score.toLocaleString();
    $('sStreak').textContent = G.stats.streak;
  }

  function paintGrid() {
    const C = G.C;
    const grid = $('grid'), colH = $('colHeads'), rowH = $('rowHeads');
    grid.style.gridTemplateColumns = `repeat(${C.cols}, 1fr)`;
    colH.style.gridTemplateColumns = `repeat(${C.cols}, 1fr)`;
    rowH.style.gridTemplateRows = `repeat(${C.rows}, 1fr)`;

    if (colH.children.length !== C.cols) {
      colH.innerHTML = '';
      for (let c = 0; c < C.cols; c++) {
        const b = document.createElement('button');
        b.textContent = c + 1;
        b.addEventListener('click', () => { if (G.armed === 'dowse') takeReading('dowse', { axis: 'col', index: c }); });
        colH.appendChild(b);
      }
    }
    if (rowH.children.length !== C.rows) {
      rowH.innerHTML = '';
      for (let r = 0; r < C.rows; r++) {
        const b = document.createElement('button');
        b.textContent = r + 1;
        b.addEventListener('click', () => { if (G.armed === 'dowse') takeReading('dowse', { axis: 'row', index: r }); });
        rowH.appendChild(b);
      }
    }

    const alive = C.assist ? candidates(C) : null;

    if (grid.children.length !== C.N) {
      grid.innerHTML = '';
      for (let i = 0; i < C.N; i++) {
        const b = document.createElement('button');
        b.className = 'room';
        b.dataset.i = i;
        b.innerHTML =
          `<div class="nm">${C.rooms[i].name}</div>` +
          `<div class="attrs">${ATTRS.filter((a) => C.rooms[i].attrs[a.key])
              .map((a) => svg(ICONS[a.key])).join('')}</div>` +
          `<div class="mark"></div>`;
        b.addEventListener('click', () => onRoom(i));
        const cycleMark = () => {
          C.marks[i] = (C.marks[i] + 1) % 3;
          paintGrid();
          audio.tone({ freq: 300 + C.marks[i] * 120, dur: 0.07, type: 'square', gain: 0.05 });
        };
        b.addEventListener('contextmenu', (e) => { e.preventDefault(); cycleMark(); });

        // Long-press is the touch equivalent of the right-click mark. The flag
        // suppresses the click that a lifted finger would otherwise fire.
        let held = null, longPressed = false;
        const cancelHold = () => { clearTimeout(held); held = null; };
        b.addEventListener('pointerdown', (e) => {
          if (e.pointerType === 'mouse') return;
          longPressed = false;
          held = setTimeout(() => { longPressed = true; cycleMark(); }, 420);
        });
        b.addEventListener('pointerup', cancelHold);
        b.addEventListener('pointercancel', cancelHold);
        b.addEventListener('pointerleave', cancelHold);
        b.addEventListener('click', (e) => {
          if (longPressed) { e.preventDefault(); e.stopImmediatePropagation(); longPressed = false; }
        }, true);
        grid.appendChild(b);
      }
    }
    for (let i = 0; i < C.N; i++) {
      const el = grid.children[i];
      el.dataset.mark = ['', 'out', 'maybe'][C.marks[i]];
      el.querySelector('.mark').textContent = ['', '✕', '?'][C.marks[i]];
      el.classList.toggle('probed', C.probed[i]);
      el.classList.toggle('dead', !!(alive && !alive[i]));
    }
  }

  function paintTools() {
    const C = G.C, wrap = $('tools');
    if (wrap.children.length !== Object.keys(TOOLS).length) {
      wrap.innerHTML = '';
      for (const key in TOOLS) {
        const t = TOOLS[key];
        const b = document.createElement('button');
        b.className = 'tool';
        b.dataset.tool = key;
        b.innerHTML =
          `<span class="ico">${svg(t.icon)}</span>` +
          `<span class="txt"><span class="tn">${t.name}</span>` +
          `<span class="td">${t.blurb}</span></span>` +
          `<span class="cost">${t.cost}⚡</span>`;
        b.addEventListener('click', () => armTool(key));
        wrap.appendChild(b);
      }
    }
    for (const b of wrap.children) {
      const t = TOOLS[b.dataset.tool];
      b.disabled = G.over || C.charges < t.cost;
      b.classList.toggle('armed', G.armed === b.dataset.tool);
    }
    $('commitBtn').classList.toggle('armed', G.committing);
    $('commitBtn').disabled = G.over;
  }

  function paintLog() {
    const C = G.C, log = $('log');
    if (!C.readings.length) {
      log.innerHTML = '<li class="empty">Nothing recorded yet.</li>';
      return;
    }
    const parts = [];
    C.readings.forEach((r, i) => {
      if (C.moving && i > 0 && i % C.moveEvery === 0) {
        parts.push(`<li class="moved">— it moved one room —</li>`);
      }
      parts.push(`<li><span class="n">${i + 1}</span>${describe(r, C)}</li>`);
    });
    if (C.moving && C.readings.length > 0 && C.readings.length % C.moveEvery === 0) {
      parts.push(`<li class="moved">— it moved one room —</li>`);
    }
    log.innerHTML = parts.join('');
    log.scrollTop = log.scrollHeight;
  }

  function paintPrompt() {
    const C = G.C, p = $('prompt');
    if (G.over) { p.innerHTML = ''; return; }
    if (G.committing) { p.innerHTML = 'Click the room you are naming. <b>One answer only.</b>'; return; }
    if (G.armed === 'dowse') { p.innerHTML = 'Click a <b>row or column number</b> to drag the rod along it.'; return; }
    if (G.armed === 'thermo' || G.armed === 'compass') {
      p.innerHTML = `Click a room to probe it with the <b>${TOOLS[G.armed].name}</b>.`;
      return;
    }
    const n = countSet(candidates(C));
    if (C.charges === 0) { p.innerHTML = 'Out of charges. <b>Name a room.</b>'; return; }
    p.innerHTML = C.assist
      ? `<b>${n}</b> room${n === 1 ? '' : 's'} still fit your readings.`
      : 'Choose an instrument, then a room.';
  }

  /* ---------------------------------------------------------
     interaction
     --------------------------------------------------------- */
  function armTool(key) {
    audio.unlock();
    const C = G.C;
    if (G.over || C.charges < TOOLS[key].cost) return;
    G.committing = false;
    G.armed = G.armed === key ? null : key;
    document.body.classList.remove('arm-room', 'arm-dowse', 'arm-commit');
    if (G.armed) {
      const t = TOOLS[G.armed].target;
      if (t === 'room') document.body.classList.add('arm-room');
      if (t === 'line') document.body.classList.add('arm-dowse');
      if (t === 'attr') { openSeance(); }
    }
    audio.tone({ freq: 520, to: 640, dur: 0.09, type: 'triangle', gain: 0.06 });
    paintTools(); paintPrompt();
  }

  function onRoom(i) {
    if (G.over) return;
    if (G.committing) { commit(i); return; }
    if (!G.armed) return;
    const t = TOOLS[G.armed].target;
    if (t !== 'room') return;
    document.body.classList.remove('arm-room');
    takeReading(G.armed, { target: i });
  }

  function openSeance() {
    const wrap = $('seanceOpts');
    wrap.innerHTML = '';
    for (const a of ATTRS) {
      const b = document.createElement('button');
      b.className = 'attr-opt';
      b.innerHTML = svg(ICONS[a.key]) + `<span>${a.label}</span>`;
      b.addEventListener('click', () => {
        $('seancePop').hidden = true;
        takeReading('seance', { attr: a.key });
      });
      wrap.appendChild(b);
    }
    $('seancePop').hidden = false;
  }
  $('seanceCancel').addEventListener('click', () => {
    $('seancePop').hidden = true;
    G.armed = null;
    paintTools(); paintPrompt();
  });

  $('commitBtn').addEventListener('click', () => {
    audio.unlock();
    if (G.over) return;
    G.committing = !G.committing;
    G.armed = null;
    document.body.classList.remove('arm-room', 'arm-dowse');
    document.body.classList.toggle('arm-commit', G.committing);
    paintTools(); paintPrompt();
  });

  $('assistToggle').addEventListener('change', (e) => {
    if (!G.C) return;
    G.C.assist = e.target.checked;
    if (e.target.checked) G.C.usedAssist = true;
    paintGrid(); paintPrompt();
  });

  /* ---------------------------------------------------------
     flow
     --------------------------------------------------------- */
  const OVER = ['ovHelp', 'ovResult', 'ovStart'];
  const show = (id) => OVER.forEach((o) => { $(o).hidden = o !== id; });
  const hideAll = () => OVER.forEach((o) => { $(o).hidden = true; });

  function startCase(n) {
    G.caseNo = n;
    G.C = makeCase(n, Math.floor(Math.random() * 1e9));
    G.armed = null; G.committing = false; G.over = false;
    document.body.classList.remove('arm-room', 'arm-dowse', 'arm-commit');
    $('grid').innerHTML = '';
    $('colHeads').innerHTML = '';
    $('rowHeads').innerHTML = '';
    Store.set('cs:case', n);
    paintAll();
    hideAll();
    if (G.C.moving) {
      setTimeout(() => {
        $('prompt').innerHTML = '<b>This one moves.</b> One room, after every second reading.';
      }, 60);
    }
  }

  $('startBtn').addEventListener('click', () => {
    audio.unlock(); audio.setReverb(0.42);
    startCase(Store.get('cs:case', 1));
  });
  $('helpBtn').addEventListener('click', () => { paintToolHelp(); show('ovHelp'); });
  $('closeHelp').addEventListener('click', () => { if (G.C) hideAll(); else show('ovStart'); });
  $('nextBtn').addEventListener('click', () => {
    const wonLast = G.stats.streak > 0;
    startCase(wonLast ? G.caseNo + 1 : G.caseNo);
  });

  function paintToolHelp() {
    const dl = $('toolHelp');
    dl.innerHTML = Object.keys(TOOLS).map((k) => {
      const t = TOOLS[k];
      return `<dt>${svg(t.icon)} ${t.name} <span class="c">${t.cost}⚡</span></dt><dd>${t.help}</dd>`;
    }).join('');
  }

  /* ---------------------------------------------------------
     atmosphere
     --------------------------------------------------------- */
  const mood = $('mood');
  const mx = mood.getContext('2d');
  let motes = [], pulse = 0, moodT = 0;

  function coldPulse() { pulse = 1; }
  function pingRoom(i) {
    const el = $('grid').children[i];
    if (!el) return;
    el.classList.remove('pinged');
    void el.offsetWidth;
    el.classList.add('pinged');
  }

  function moodFrame(now) {
    requestAnimationFrame(moodFrame);
    const t = now / 1000;
    const dt = Math.min(0.05, t - moodT || 0.016);
    moodT = t;
    const s = A.fitCanvas(mood, mx, 1.5);

    if (motes.length === 0 || motes.w !== s.w) {
      motes = [];
      motes.w = s.w;
      const r = Rng('motes');
      for (let i = 0; i < 60; i++) {
        motes.push({ x: r() * s.w, y: r() * s.h, z: r() * 0.7 + 0.3, s: r() * 1.5 + 0.4, ph: r() * TAU });
      }
    }

    mx.clearRect(0, 0, s.w, s.h);

    // dust in the lamplight
    for (const m of motes) {
      m.y -= m.z * 7 * dt;
      m.x += Math.sin(t * 0.4 + m.ph) * 5 * dt;
      if (m.y < -4) { m.y = s.h + 4; m.x = Math.random() * s.w; }
      mx.globalAlpha = 0.05 + m.z * 0.13;
      mx.fillStyle = '#e8cfa6';
      mx.fillRect(m.x, m.y, m.s, m.s);
    }
    mx.globalAlpha = 1;

    // candlelight: a vignette that will not sit still
    const flick = 0.90 + Math.sin(t * 7.3) * 0.022 + Math.sin(t * 17.1) * 0.014 + Math.sin(t * 2.3) * 0.02;
    const cx = s.w * 0.46, cy = s.h * 0.44;
    const g = mx.createRadialGradient(cx, cy, s.h * 0.14, cx, cy, s.h * flick * 1.25);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.55, 'rgba(4,3,2,0.30)');
    g.addColorStop(1, 'rgba(3,2,1,0.86)');
    mx.fillStyle = g;
    mx.fillRect(0, 0, s.w, s.h);

    // cold bloom after a reading or a move
    if (pulse > 0.002) {
      pulse = Math.max(0, pulse - dt * 1.3);
      const r = lerp(s.h * 0.1, s.h * 1.1, 1 - pulse);
      const pg = mx.createRadialGradient(cx, cy, 0, cx, cy, r);
      pg.addColorStop(0, `rgba(143,201,234,0)`);
      pg.addColorStop(0.75, `rgba(143,201,234,${pulse * 0.06})`);
      pg.addColorStop(1, 'rgba(143,201,234,0)');
      mx.fillStyle = pg;
      mx.fillRect(0, 0, s.w, s.h);
    }
  }

  /* ---------------------------------------------------------
     boot
     --------------------------------------------------------- */
  A.mountChrome(audio);
  paintToolHelp();
  show('ovStart');
  requestAnimationFrame(moodFrame);

  /* ---------------------------------------------------------
     debug hook — also used to prove cases are solvable in budget
     --------------------------------------------------------- */
  window.__CS = {
    G, TOOLS, ATTRS, makeCase, candidates, countSet, satisfies, xy,
    caseSpec, currentT, truthNow, readingResult, orthNeighbors,
    startCase, takeReading, commit,
    state() {
      const C = G.C;
      return C && { n: C.n, cols: C.cols, rows: C.rows, charges: C.charges,
        readings: C.readings.length, moving: C.moving,
        candidates: countSet(candidates(C)), truth: truthNow(C) };
    },
  };
})();
