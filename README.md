# Cartridge

A small arcade of handmade browser games. No engine, no framework, no
dependencies, no build step — every graphic is drawn to a canvas at runtime and
every sound is synthesised in the browser the moment you hear it.

**▶ [Play it](https://patrickdx.github.io/cartridge/)**

---

## The games

### 🕐 Chrono Echo — *time-loop puzzle platformer*

You get one body, but you get it several times. Each loop records a **take**;
every take you have already made replays beside you as a **solid body** you can
stand on, ride, and be crushed by.

The trick that makes it work: echoes replay by **recorded position**, not by
replayed input. That makes the whole simulation trivially deterministic — no
divergence, no paradoxes, no accumulating float error — and it means an echo
standing on an older echo is automatically consistent forever.

Hold <kbd>Q</kbd> to **rewind the current take live** and branch a new timeline
from any point in it. The recording truncates at the scrub point, the world,
the echoes and your collected orbs all roll back with you, and you carry on from
there.

Nine hand-built levels teaching pressure plates, gates, echo-stacking, timed
beams, moving platforms and orb persistence. Level geometry was verified against
the *measured* jump arc rather than the intended one: a 2-tile hop is free, a
3-tile ledge is impossible alone but reachable from one echo's shoulders, and a
4-tile ledge needs two echoes stacked. Every level was then played through by a
scripted bot to prove it completes at or under par.

Then there's **the Forge** — paint your own board from a 15-brush palette, test
it in place, and share it as a link. The level is remapped to a digit-free
alphabet, run-length encoded and packed into the URL hash, so a full board with
a laser fits in about 310 characters. Nothing to host, nothing to sign into.
Opening someone's link drops you straight into their level; Esc opens it in the
forge to remix.

### 🛰 Orbital Drift — *physics arcade*

A probe with no engine worth mentioning, loose in a gravity well. Every body
pulls on you all the time. Your only real control is **what to fall toward**:
hold the mouse to tether the nearest world and multiply its pull, release to
keep everything you gained.

Tether on the way *in* and release at the closest point and you have a
slingshot. Tether on the way *out* to shed speed you cannot survive.

The dotted line showing your future runs the **same integrator, at the same
substep size, over the same bodies** as the live simulation — so it agrees with
reality to within about 5px over 900px of flight, and the game is one of skill
rather than hope. That guarantee survives contact with time-dependent forces:
**pulsars** fire an expanding shock front on a fixed beat, and the preview
evaluates those fronts at their *future* positions rather than their current
ones. **Wormholes** come in linked pairs and preserve velocity through transit;
the preview follows them too, breaking the line at the mouth and resuming at the
far side.

Sectors are procedurally generated with a guaranteed clear launch corridor and a
survey phase that holds the probe still while you read the field.

### 🕯 Cold Spot — *deduction*

Something is in the house, in exactly one room. Four instruments, each with a
charge cost and its own shape of partial truth: an exact distance, a bearing, a
corridor sweep, and one yes-or-no question about the room it haunts. Every
reading is honest. None is enough alone.

Readings are stored as **predicates over grid positions** and the consistent set
is recomputed from scratch each time. From the sixth case the presence starts
**moving** — one room, orthogonally, after every second reading — at which point
a single candidate set is no longer sufficient. The engine keeps a set per time
step and runs a **forward/backward consistency pass** over them, so "where could
it be *now*" stays exactly answerable.

Charge budgets were tuned by running an information-gain solver over hundreds of
generated cases: static houses are always fully determinable with charges to
spare, and the moving ones resolve to a single room about 90% of the time —
leaving the occasional genuine coin-flip.

There are exactly four instruments, and that is deliberate. Two more were built
and measured — a plumb line strung between two rooms, and a cold trail reading
the direction of the last move — and both were cut, because measurement showed
the compass dominated them even with cost taken out of the comparison. A fifth
button nobody should press is worse than four that all have a niche.

---

## Structure

```
index.html              the arcade shelf, with a live miniature per game
assets/arcade.js        shared runtime — seeded RNG, Web Audio synth, input,
                        particles, fixed-timestep loop, canvas helpers
assets/arcade.css       shared chrome
games/<name>/           one folder per game: index.html, style.css, game.js
```

Each game exposes a debug hook (`window.__CE`, `__OD`, `__CS`) that drives its
simulation synchronously, which is how the physics and the solvers above were
verified without depending on the render loop.

## Running locally

It is static files, so anything will serve it:

```bash
python3 -m http.server 8765
```

Then open <http://localhost:8765>.

## Notes

Chrono Echo needs a keyboard; Orbital Drift needs a mouse. Nothing is uploaded
anywhere — progress and high scores live in your browser's local storage.
