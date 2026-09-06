/* ============================================================
   RUNG
   A word ladder. Change one letter at a time; every rung must be a
   real word.

   Two words are neighbours when they differ in exactly one position,
   which turns the lexicon into a graph. Par is then not a designer's
   guess at a good route — it is a breadth-first search, so it is
   provably the shortest ladder that exists. Rusted words are simply
   nodes deleted from the graph before the search runs, so the par
   quoted for a rusted puzzle is still exactly right.
   ============================================================ */
(function () {
  'use strict';

  const A = window.Arcade;
  const { clamp, Store, Rng } = A;
  const audio = new A.AudioKit();

  /* ---------------------------------------------------------
     the graph
     --------------------------------------------------------- */
  const LEX = window.RUNG_LEX || [];
  const IDX = new Map(LEX.map((w, i) => [w, i]));
  const ADJ = LEX.map(() => []);

  (function buildGraph() {
    for (let i = 0; i < LEX.length; i++) {
      const w = LEX[i];
      for (let p = 0; p < 4; p++) {
        for (let c = 97; c < 123; c++) {
          const ch = String.fromCharCode(c);
          if (ch === w[p]) continue;
          const v = IDX.get(w.slice(0, p) + ch + w.slice(p + 1));
          if (v !== undefined) ADJ[i].push(v);
        }
      }
    }
  })();

  // Shortest ladder from `from`, avoiding any word in `banned`.
  // Returns { dist:Int32Array, prev:Int32Array } over word indices.
  function bfs(from, banned) {
    const dist = new Int32Array(LEX.length).fill(-1);
    const prev = new Int32Array(LEX.length).fill(-1);
    if (banned && banned.has(from)) return { dist, prev };
    dist[from] = 0;
    const q = [from];
    for (let h = 0; h < q.length; h++) {
      const u = q[h];
      for (const v of ADJ[u]) {
        if (dist[v] !== -1) continue;
        if (banned && banned.has(v)) continue;
        dist[v] = dist[u] + 1;
        prev[v] = u;
        q.push(v);
      }
    }
    return { dist, prev };
  }

  function pathFrom(prev, target) {
    const out = [];
    for (let c = target; c !== -1; c = prev[c]) out.push(LEX[c]);
    return out.reverse();
  }

  /* ---------------------------------------------------------
     puzzles
     --------------------------------------------------------- */
  // difficulty ramp: how long the shortest ladder should be, and how many
  // words get rusted out of the graph
  function spec(n) {
    if (n <= 2) return { dist: 3, rust: 0 };
    if (n <= 4) return { dist: 4, rust: 0 };
    if (n <= 6) return { dist: 5, rust: 0 };
    if (n <= 8) return { dist: 5, rust: 1 };
    if (n <= 11) return { dist: 6, rust: 1 };
    if (n <= 14) return { dist: 6, rust: 2 };
    if (n <= 18) return { dist: 7, rust: 2 };
    return { dist: 7 + ((n - 19) % 3), rust: 3 };
  }

  function makePuzzle(n, seedNum) {
    const sp = spec(n);
    const rng = Rng('rung|' + n + '|' + seedNum);
    for (let attempt = 0; attempt < 400; attempt++) {
      const start = Math.floor(rng() * LEX.length);
      const plain = bfs(start, null);
      // candidate targets at exactly the wanted distance
      const cands = [];
      for (let i = 0; i < LEX.length; i++) if (plain.dist[i] === sp.dist) cands.push(i);
      if (!cands.length) continue;
      const target = cands[Math.floor(rng() * cands.length)];

      if (sp.rust === 0) {
        return {
          start: LEX[start], target: LEX[target],
          par: sp.dist, banned: [],
          best: pathFrom(plain.prev, target),
        };
      }

      // Rust out interior words of the shortest ladder, then re-solve. The new
      // par is whatever the graph says once those rungs are gone.
      const route = [];
      for (let c = target; c !== -1; c = plain.prev[c]) route.push(c);
      const interior = route.slice(1, -1);
      if (interior.length < sp.rust) continue;
      const picks = [];
      const pool = interior.slice();
      while (picks.length < sp.rust && pool.length) {
        picks.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
      }
      const banned = new Set(picks);
      const re = bfs(start, banned);
      const d2 = re.dist[target];
      // must still be solvable, and the rust must actually have cost something
      if (d2 < 0 || d2 <= sp.dist || d2 > sp.dist + 4) continue;
      return {
        start: LEX[start], target: LEX[target],
        par: d2, banned: picks.map((i) => LEX[i]),
        best: pathFrom(re.prev, target),
      };
    }
    // extremely unlikely, but never hand back a broken board
    return makePuzzle(1, seedNum + 1);
  }

  /* ---------------------------------------------------------
     state
     --------------------------------------------------------- */
  const G = {
    no: 1,
    pz: null,
    chain: [],          // words played, not including the start
    stats: Store.get('rg:stats', { solved: 0, streak: 0, bestStreak: 0, parSolves: 0 }),
    done: false,
    started: false,
  };

  const $ = (id) => document.getElementById(id);
  const differsByOne = (a, b) => {
    let d = 0;
    for (let i = 0; i < 4; i++) if (a[i] !== b[i]) d++;
    return d === 1;
  };

  /* ---------------------------------------------------------
     rendering
     --------------------------------------------------------- */
  function rungEl(word, prev, cls) {
    const d = document.createElement('div');
    d.className = 'rung' + (cls ? ' ' + cls : '');
    for (let i = 0; i < 4; i++) {
      const s = document.createElement('span');
      s.textContent = word[i];
      if (prev && word[i] !== prev[i]) s.className = 'changed';
      d.appendChild(s);
    }
    return d;
  }
  const linkEl = (dots) => {
    const l = document.createElement('div');
    l.className = 'link' + (dots ? ' dots' : '');
    return l;
  };

  function paintLadder(popLast) {
    const wrap = $('ladder');
    wrap.innerHTML = '';
    const pz = G.pz;
    wrap.appendChild(rungEl(pz.start, null, 'anchor'));
    let prev = pz.start;
    G.chain.forEach((w, i) => {
      wrap.appendChild(linkEl(false));
      const el = rungEl(w, prev, (popLast && i === G.chain.length - 1) ? 'pop' : '');
      wrap.appendChild(el);
      prev = w;
    });
    const solved = prev === pz.target;
    if (!solved) {
      wrap.appendChild(linkEl(true));
      wrap.appendChild(rungEl(pz.target, null, 'target'));
    }
    $('hUsed').textContent = G.chain.length;
    $('hUsed').classList.toggle('over', G.chain.length > pz.par);
  }

  function paintHead() {
    $('hNo').textContent = String(G.no).padStart(2, '0');
    $('hPar').textContent = G.pz.par;
    $('hSolved').textContent = G.stats.solved;
    $('hStreak').textContent = G.stats.streak;
    const rusted = $('rusted');
    if (G.pz.banned.length) {
      rusted.hidden = false;
      $('rustedList').innerHTML = G.pz.banned.map((w) => `<span class="rust">${w}</span>`).join('');
    } else rusted.hidden = true;
    $('hHint').textContent = G.pz.banned.length
      ? 'Some rungs are rusted through.'
      : 'Change one letter at a time.';
  }

  function say(msg, cls) {
    const el = $('say');
    el.textContent = msg || ' ';
    el.className = cls || '';
  }

  /* ---------------------------------------------------------
     play
     --------------------------------------------------------- */
  function submit(raw) {
    if (G.done) return;
    const w = (raw || '').trim().toLowerCase();
    const prev = G.chain.length ? G.chain[G.chain.length - 1] : G.pz.start;

    if (w.length !== 4) return bad('four letters');
    if (!/^[a-z]{4}$/.test(w)) return bad('letters only');
    if (w === prev) return bad('that is where you are');
    if (!differsByOne(prev, w)) return bad('exactly one letter at a time');
    if (!IDX.has(w)) return bad(`"${w}" is not in the lexicon`);
    if (G.pz.banned.includes(w)) return bad(`"${w}" is rusted through`);
    if (G.chain.includes(w) || w === G.pz.start) return bad('you have already stood there');

    G.chain.push(w);
    paintLadder(true);
    $('word').value = '';
    audio.tone({ freq: 460 + G.chain.length * 22, dur: 0.09, type: 'triangle', gain: 0.09 });

    if (w === G.pz.target) win();
    else say('');
  }

  function bad(msg) {
    say(msg, 'err');
    const wrap = $('ladder');
    const last = wrap.querySelectorAll('.rung');
    const el = last[G.chain.length];
    if (el) { el.classList.remove('bad'); void el.offsetWidth; el.classList.add('bad'); }
    audio.tone({ freq: 200, to: 140, dur: 0.12, type: 'square', gain: 0.08 });
    return false;
  }

  function undo() {
    if (G.done || !G.chain.length) return;
    G.chain.pop();
    paintLadder(false);
    say('');
    audio.tone({ freq: 300, to: 220, dur: 0.07, type: 'square', gain: 0.06 });
  }

  function win() {
    G.done = true;
    const used = G.chain.length, par = G.pz.par;
    const st = G.stats;
    st.solved++;
    if (used <= par) { st.streak++; st.parSolves++; st.bestStreak = Math.max(st.bestStreak, st.streak); }
    else st.streak = 0;
    Store.set('rg:stats', st);
    paintHead();
    audio.chord([440, 554, 659, 880], { dur: 0.8, type: 'triangle', gain: 0.14, spread: 0.05, send: 0.4 });

    $('winKick').textContent = used <= par ? 'Shortest possible' : 'Solved';
    $('winKick').className = 'kicker' + (used <= par ? ' par' : '');
    $('winTitle').textContent = used <= par
      ? `${G.pz.start.toUpperCase()} to ${G.pz.target.toUpperCase()} in ${used}`
      : `${used} rungs — the shortest is ${par}`;
    const mine = [G.pz.start, ...G.chain];
    $('winLadder').innerHTML = (used <= par ? mine : G.pz.best)
      .map((w) => `<b class="${used <= par ? 'mine' : ''}">${w}</b>`).join('<i>→</i>');
    $('winNote').textContent = used <= par
      ? 'No shorter ladder exists between those two words. That is a breadth-first search talking, not an opinion.'
      : 'That is the shortest route, found by searching the whole lexicon.';
    setTimeout(() => show('ovWin'), 520);
  }

  function giveUp() {
    if (G.done) return;
    G.done = true;
    G.stats.streak = 0;
    Store.set('rg:stats', G.stats);
    paintHead();
    $('winKick').textContent = 'The shortest ladder';
    $('winKick').className = 'kicker';
    $('winTitle').textContent = `${G.pz.start.toUpperCase()} to ${G.pz.target.toUpperCase()} in ${G.pz.par}`;
    $('winLadder').innerHTML = G.pz.best.map((w) => `<b>${w}</b>`).join('<i>→</i>');
    $('winNote').textContent = 'Streak reset. The next one starts clean.';
    audio.tone({ freq: 240, to: 150, dur: 0.4, type: 'sawtooth', gain: 0.1 });
    show('ovWin');
  }

  /* ---------------------------------------------------------
     flow
     --------------------------------------------------------- */
  const OVER = ['ovHelp', 'ovWin', 'ovStart'];
  const show = (id) => OVER.forEach((o) => { $(o).hidden = o !== id; });
  const hideAll = () => OVER.forEach((o) => { $(o).hidden = true; });
  const anyOverlay = () => OVER.some((o) => !$(o).hidden);

  function load(n) {
    G.no = n;
    G.pz = makePuzzle(n, Store.get('rg:seed', 1));
    G.chain = [];
    G.done = false;
    paintHead();
    paintLadder(false);
    say('');
    hideAll();
    $('word').value = '';
    $('word').focus();
    Store.set('rg:last', n);
  }

  A.mountChrome(audio);
  $('startBtn').addEventListener('click', () => {
    audio.unlock(); audio.setReverb(0.1);
    G.started = true;
    if (!Store.get('rg:seed', 0)) Store.set('rg:seed', Math.floor(Math.random() * 1e6));
    load(Store.get('rg:last', 1));
  });
  $('helpBtn').addEventListener('click', () => show('ovHelp'));
  $('closeHelp').addEventListener('click', () => { if (G.started) { hideAll(); $('word').focus(); } else show('ovStart'); });
  $('nextBtn').addEventListener('click', () => load(G.no + 1));
  $('retryBtn').addEventListener('click', () => load(G.no));
  $('undoBtn').addEventListener('click', () => { undo(); $('word').focus(); });
  $('giveBtn').addEventListener('click', giveUp);

  $('entry').addEventListener('submit', (e) => {
    e.preventDefault();
    audio.unlock();
    submit($('word').value);
  });
  $('word').addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && !$('word').value) { e.preventDefault(); undo(); }
  });
  window.addEventListener('keydown', (e) => {
    if (!G.started || anyOverlay()) return;
    if (document.activeElement !== $('word') && /^[a-zA-Z]$/.test(e.key)) $('word').focus();
  });

  show('ovStart');

  /* ---------------------------------------------------------
     debug hook
     --------------------------------------------------------- */
  window.__RG = {
    G, LEX, ADJ, IDX, bfs, pathFrom, makePuzzle, spec, load, submit, differsByOne,
    // Is a proposed ladder legal end to end?
    verify(pz, words) {
      const seq = [pz.start, ...words];
      for (let i = 1; i < seq.length; i++) {
        if (!IDX.has(seq[i])) return 'not a word: ' + seq[i];
        if (!differsByOne(seq[i - 1], seq[i])) return 'not one letter: ' + seq[i - 1] + '->' + seq[i];
        if (pz.banned.includes(seq[i])) return 'rusted: ' + seq[i];
      }
      if (seq[seq.length - 1] !== pz.target) return 'did not reach the target';
      return true;
    },
    stats() {
      return { words: LEX.length,
               edges: ADJ.reduce((a, l) => a + l.length, 0) / 2,
               meanDegree: +(ADJ.reduce((a, l) => a + l.length, 0) / LEX.length).toFixed(2) };
    },
  };
})();
