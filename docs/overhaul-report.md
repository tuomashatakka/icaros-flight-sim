# Crash Velocity — optimization and overhaul report

Baseline: `main` at `34661ed` (2026-09-16), measured 2026-09-18. This is the
continuation of [`cleanup-analysis.md`](./cleanup-analysis.md), which was
baselined at `16a5adf` before the package split; that document's ledger is
closed out in §2.3 and its still-open items are folded into the roadmap in §7.

Three read-only exploration passes (architecture and tooling; the per-frame hot
path; netcode, server and app shell) produced the findings. Every one of them
was spot-checked against the file it names, and every number in §1 and §8 comes
from a command listed in the appendix. Where a number could not be measured on
this machine it says so rather than estimating.

The user asked for "a complete overhaul". Read to the end of §0 before taking
that literally.

---

## 0. Executive summary

**This codebase is already disciplined, and the overhaul is not a rewrite.**
There are zero `TODO`/`FIXME` markers in ~40k lines because the house style
records constraints in prose instead. Four `any` types, six `eslint-disable`s
and zero `@ts-ignore`s across eleven packages. The frame trace is in the order the
architecture demands. Scratch vectors are hoisted, the prediction rings are
typed arrays, the transports memoise their views, scenery is instanced, CI
already runs eight determinism replays and greps the bundle for leaks. Most
projects would be glad to arrive here after an overhaul.

What the audit found instead is narrower and more valuable:

1. **One missing player-facing feature.** The server grants a 15 s reconnection
   grace window; the client never uses it. A mid-match socket drop is silent
   and unrecoverable (§4.3, N1).
2. **Two fail-open operational defaults.** The Colyseus monitor and playground
   are on unless the operator remembers `NODE_ENV=production`, and nothing
   rate-limits registration, ticket minting or room joins (N2, N3).
3. **A measurement layer the server never had.** Tick cost per room and the
   rooms-per-process ceiling were never measured. §1 measures the simulation
   half headless; §7 adds the instrumentation for the rest.
4. **A handful of verified hot-path and GPU fixes.** MSAA paid for and thrown
   away, a full-resolution depth-of-field target, per-instance texture clones,
   an O(n²) allocation in battle's lock-on, one stray array in the physics step
   (§3.3, §4.3).
5. **Finishing what the last ledger started.** The HUD split and the battle
   composition-root split have regressed since `cleanup-analysis.md` measured
   them; the lint ratchet was never added and warnings have gone from 63 to
   121 since; three copies of `MessageKind` exist.

### Scorecard

| axis | today | target | the three moves that get there |
| --- | --- | --- | --- |
| runtime (client) | frame trace correct; allocation discipline holds; MSAA wasted, no AA pass; full-res DoF target; 12 texture sets for 12 same-hull ships | real anti-aliasing at lower GPU cost; VRAM proportional to distinct hulls; zero steady-state render allocation (the existing `battle-allocation-profile.md` bar) | R1 AA pass + `antialias:false` · R2 half-res DoF · R3 shared textures |
| netcode + server | wire format tight (30.3 B / 11.3 B per ship); rooms leak-free; reconnection absent; tick cost unmeasured; devtools fail-open | a drop mid-match recovers inside the grace window; p95 tick time on `/health`; monitor off by default | N1 reconnection · N2 fail-closed devtools + deploy artefact · tick histogram |
| architecture + DX | 5 `any`, 2 % dead exports, strong CI; HUD files up to 924 lines; `game/battle.ts` 615 vs a 250 target; 3 packages with zero tests; no lint ratchet | every file under 500 lines by rule; one `MessageKind`; a first test in every package; warnings can only go down | lint + size ratchet · HUD painter table · transport base in `Ξ` |
| load + assets (appendix) | no Draco/KTX2; `public/` mostly uncompressed PNG | out of scope for this report — see `cleanup-analysis.md` §1.1 | — |

---

## 1. Baseline, measured

All commands ran on this machine at `34661ed` with a clean tree. Browser-side
numbers are deliberately absent from the frame-time rows: `scripts/dev-cli.mjs`
forces SwiftShader (`--use-angle=swiftshader`, `dev-cli.mjs:244-249`) so that
headless Chromium can create a WebGL context at all, which makes any in-page
frame time a software-rasteriser figure, not a GPU one. The probe is still the
right tool for draw-call, triangle and texture *counts*, which do not depend on
the rasteriser; those are collected in §3.2 where available.

### 1.1 Provenance

| item | value |
| --- | --- |
| commit | `34661ed` on `main` |
| tree | clean before the run; after it, the only untracked file is this report |
| machine | Apple M5, 10 cores, macOS 27.0 |
| runtimes | bun 1.4.2 · node 26.8.1 · next 16.2.9 (Turbopack) · three 0.185.1 · `@dimforge/rapier3d-deterministic-compat` 0.19.2 |

### 1.2 The check ladder

| step | result | wall time |
| --- | --- | --- |
| `bun run aliases:check` | pass | 0.07 s |
| `bun run typecheck` (12 serial `tsc -p`) | pass | 13.4 s |
| `bun run lint` | 0 errors, **121 warnings** (36 auto-fixable). The previous ledger measured 63. | — |
| `bun run test` (vitest, one runner) | 34 files, 371 tests, all green | 3.95 s |
| 6 race + 2 battle replays | 8 / 8 `deterministic: true` | tens of ms each |
| `bun run build` (Turbopack) | pass; `.next/static` = 5.4 MB | 5.3 s on a warm cache |
| leak greps on `.next/static` | clean for all six: `__dev`, `colyseus/core`, `drizzle-orm`, `@neondatabase`, `pglite`, `zustand` | — |

### 1.3 Determinism

Both harnesses build a fresh sim per run and hash a millimetre-quantised pose
trace per tick. `deterministic` is the first field to read; if it were ever
`false` nothing else in this report would matter until it was fixed.

| script | mode | ticks | deterministic | hash |
| --- | --- | --- | --- | --- |
| straight-line | race | 720 | true | `53239d7e` |
| hard-corner | race | 960 | true | `31ce6ca4` |
| turn-response | race | 120 | true | `0c6f60bc` |
| strafe-response | race | 120 | true | `8556e4fa` |
| boost-jump | race | 840 | true | `1e778dbb` |
| respawn | race | 600 | true | `f568dd0c` |
| point-blank | battle | 900 | true | `68c5ad56` |
| straight-fight | battle | 600 | true | `984cb984` |

### 1.4 Simulation tick cost, headless

Measured with the replay CLIs, which accept a JSON path and `--runs N`. Timing
`--runs 2` against `--runs 50` and dividing the difference by 48 cancels Bun
start-up and module-graph cost, leaving the per-run simulation time. Ship
counts come from throwaway copies of `straight-fight.json` (battle, `bots`
raised) and `straight-line.json` (race, `racers` duplicated) written to a
scratch directory, never to the repo.

| mode | ships | ticks / run | `--runs 2` median | `--runs 50` median | µs / tick | rooms / process, sim alone |
| --- | --- | --- | --- | --- | --- | --- |
| race | 1 | 720 | 0.063 s | 0.290 s | 6.6 | 1 521 |
| race | 2 | 720 | 0.073 s | 0.425 s | 10.2 | 980 |
| race | 8 | 720 | 0.112 s | 1.247 s | 32.8 | 304 |
| race | 12 | 720 | 0.139 s | 1.811 s | 48.4 | 206 |
| battle | 2 | 600 | 0.092 s | 0.501 s | 14.2 | 703 |
| battle | 8 | 600 | 0.151 s | 1.905 s | 60.9 | 164 |
| battle | 16 | 600 | 0.262 s | 4.268 s | 139.1 | 71 |

Medians of three trials each. Battle scripts are `straight-fight` with `bots` raised to 0 / 6 / 14; the bots fire (85 `fire` events over 600 ticks in the stock script), so the battle column is fire-rate-sensitive, not idle flight. Race scripts are `straight-line` with the racer entry duplicated. Because per-run cost also includes sim and collider construction amortised over the ticks, these are mild upper bounds on steady-state cost; the WASM module is a process-wide singleton and does not repeat per run.

Read the last column carefully: it is the ceiling set by the **simulation
alone** on a single Bun event loop, at 60 Hz with 40 % headroom. It excludes
Colyseus's own patch encoding, the bit-packed snapshot encode, WebSocket
writes and GC. Two things in the table matter more than the absolute values.
At full occupancy the simulation is under one percent of the tick budget
(139 µs of 16 667 at sixteen battle ships), so whatever a server actually
spends per tick is being spent around the sim, not in it. And the cost is
super-linear: eight times the ships cost battle 9.8× the microseconds
(14.2 → 139.1) and race 4.7× for six times the ships — the O(n²) work
described in §4.3 N4, visible in a measurement. §4.2 draws the conclusion.

---

## 2. Architecture as-is

### 2.1 The package DAG

Eleven workspace packages plus the Next app, one glyph each, with the edges
declared in `scripts/aliases.mjs:27-39` and enforced by the generated
`tsconfig.json` `paths` (`bun run aliases:check` fails CI on a hand edit or an
import that leaves a package's `src/`). The three leaves are the only packages
that may be shared by both modes.

```
                 Δ src/  (Next shell)
                     │
        ┌────────────┴────────────┐
        Ʊ ui                     § server
        │                        │
        Ɠ game                   │
        │                        │
        Σ engine ───────┐        │
        │               │        │
        Ƨ state         │        │
        │               │        │
        Ȼ core          │        │
        │  \            │        │
        Ψ battle    Λ race ──────┤
           \   │   /   │         │
            Φ physics  Ξ net   Ð data        ← leaves
```

`server → race, battle, data, net` · `core → physics, battle` ·
`state → core, physics, battle, race` · `engine → state, core, physics, net,
race, battle` · `game → engine + all below` · `ui → game + all below`.

### 2.2 Size

| package | glyph | source lines | files | test lines | test files |
| --- | --- | --- | --- | --- | --- |
| engine | `Σ` | 19 504 | 77 | 1 528 | 12 |
| battle | `Ψ` | 4 036 | 21 | 1 066 | 4 |
| ui | `Ʊ` | 3 793 | 21 | 408 | 3 |
| race | `Λ` | 2 503 | 19 | 412 | 4 |
| physics | `Φ` | 2 187 | 14 | 309 | 4 |
| net | `Ξ` | 1 975 | 15 | 532 | 3 |
| game | `Ɠ` | 1 790 | 4 | 0 | 0 |
| data | `Ð` | 951 | 12 | 186 | 2 |
| state | `Ƨ` | 935 | 12 | 0 | 0 |
| core | `Ȼ` | 879 | 8 | 33 | 1 |
| `src/` | `Δ` | 785 | 14 | — | — |
| server | `§` | 167 | 2 | 0 | 0 |
| **total** | | **39 505** | **233** | **4 474** | **33** (+1 in root `test/`) |

`engine` is half of all package code, and its HUD subtree is the single
largest cluster. The files that matter for §5.2:

| file | lines |
| --- | --- |
| `packages/battle/src/sim.ts` | 1 089 |
| `packages/engine/src/hud/spatial-hud.ts` | 924 |
| `packages/engine/src/hud/chrome.ts` | 809 |
| `packages/engine/src/battle/visuals.ts` | 729 |
| `packages/physics/src/vehicle-step.ts` | 701 |
| `packages/engine/src/hud/overlay.ts` | 680 |
| `packages/engine/src/hud/facets.ts` | 671 |
| `packages/game/src/battle.ts` | 615 |
| `packages/engine/src/ship/materials.ts` | 615 |
| `packages/engine/src/dev/overlay.ts` | 597 |
| `packages/engine/src/scenes/base.ts` | 582 |
| `packages/engine/src/hud/instruments.ts` | 553 |

### 2.3 Closing the previous ledger

`cleanup-analysis.md` annotated itself in place; this table is the state at
`34661ed`, re-measured rather than re-read.

| item | then | now | verdict |
| --- | --- | --- | --- |
| 1.1 asset purge | partial | unchanged: `public/spaceship_-_cb1`, `ships/*.fbx`, hangar PNGs still uncompressed | open, appendix only |
| 1.2 `BattleSim` split | done, 1 089 lines | 1 089 lines | done; §7 item 16 continues it |
| 1.3 battle publish module | done | `publish-battle.ts` owns every store write | done |
| 1.4 `mountBattle` to 250 lines | 593 | **615** | regressed |
| 1.5 parallel PRs | process note | CI now runs the full ladder | done by CI |
| 1.6 HUD split | open, files 660/654/840/385 | **680 / 671 / 924 / 429**, plus `chrome.ts` 809 | regressed, larger |
| 2.1 shared room/CLI/transport | partial | `pongFor` and `runReplayCli` shared; transport base not built | partial |
| 2.2 `mulberry32` ×3 | done | `Φrng` | done |
| 2.3 alias unification | done | glyphs everywhere; `@/` gone | done |
| 2.4 dead files, doc drift | done | new drift, see §5.8 | reopened |
| 2.5 materials table | done | `PATTERNS` table | done |
| 2.6 lint ratchet | open | no `--max-warnings`, no `max-lines` | open |
| 2.7 `utils.ts` | done | gone | done |
| 2.8 random ranges | done | `Ȼship/random-ranges` | done |
| 2.9 unused deps | done | `zod` back in `net` and `data`, `drizzle-zod` in `data`, none imported | reopened |
| T3 `Date.now()` in `Ξ` builders | open | `buildSnapshot`, `pongFor` still call it | open |
| T3 `STEP` declared twice | open | `physics/src/clock.ts` and `net/src/rates.ts` | open, but see §7 item 12 for why an import cannot fix it |
| T3 `AnyApp = App<any>` | open | still there, with its `eslint-disable`s | open |

---

## 3. Runtime hot path

### 3.1 The frame, as it actually runs

This is the invariant the rest of the section is measured against. It is
correct today; the report documents it so that nothing in §7 breaks it.

| step | where | what |
| --- | --- | --- |
| module order | `packages/engine/src/scenes/base.ts:287-356` | environment → scene-geometry → ship-visual → HUD → input-sync → `race-net`/`battle-net` → `physics-step` → publish → impact → extras → `postProcessing` (last, owns the composer) |
| clock | `packages/physics/src/clock.ts` | `STEP = 1/60`, `MAX_SUB_STEPS = 5`; overflow is dropped and the accumulator zeroed, so a hidden tab slows the sim instead of death-spiralling |
| tick | `packages/game/src/race.ts:294-405`, `battle.ts:438-503` | read controls → `transport.pushInput` → `prediction.step` (forces via `stepHovercraft`, no `world.step`) → on a new snapshot only, `prediction.reconcile` → `publishTelemetry` |
| integrate | `packages/engine/src/modules/physics-step.ts:26-35` | `world.step()` with no event queue (nothing consumes collision events; crash and hit detection are computed explicitly in the sims), then `interpolator.commit()` |
| draw | `packages/engine/src/scenes/base.ts:404-429` | `interpolator.sample(clock.alpha())` **plus** `prediction.smoothing()` — the render offset that makes the middle correction tier visible |

Everything below is measured against that sequence. Nothing in §7 reorders it.

### 3.2 What is already right

- **Scratch is hoisted.** Module-scope `Vector3`/`Quaternion` in
  `vehicle-step.ts:23-38`, `scenes/base.ts:63-69`, `net/prediction.ts:200-203`,
  `physics/interpolation.ts:5-6`, `battle/sim.ts:109-114`, `race/sim.ts:95-96`.
  `PredictedPoses` and both interpolators are flat `Float64Array`/`Int32Array`
  rings with zero per-sample allocation (`packages/net/src/prediction.ts:130-183`).
- **Debug cost is compiled out.** `forces.slice()` in the physics step only runs
  when `COLLECT_FORCES` is true, and that is `NODE_ENV !== 'production'`
  (`vehicle-step.ts:54`).
- **Transports memoise.** `frame()` in both `engine/src/{race,battle}/transport.ts`
  rebuilds its view only when the snapshot identity or the Schema state version
  changes, so it fires at 30 Hz, not at render rate.
- **The HUD is dirty-gated.** Seven canvas panels re-rasterise and re-upload only
  when a composed key changes, capped at `hudHz` (≤ 20 Hz); the expensive
  battle `target(frame)` ray-march is throttled separately
  (`hud/index.ts:131-157`). `HudPanel.resize()` disposes and reallocates the
  texture, which is the only correct way to resize a `CanvasTexture`.
- **Draw calls are already batched.** `InstancedMesh` for props, fences and
  arena scenery (`levels/props.ts`, `levels/shared.ts`, `battle/scenery.ts`,
  `battle/arena-visuals.ts`); merged geometry for HUD facets and cannons. One
  shadow-casting sun at 2048² (`environment.ts:61`), hemisphere fill, PMREM IBL.
- **Rapier WASM loads once.** Dynamic `import()` behind a module-level promise
  (`packages/physics/src/rapier.ts:20-30`), never re-decoded on remount.
- **Hull deform is not per frame.** `applyHullDeform` runs on a shape-key change
  from the hangar sliders only (`assets/ship-loader.ts:216-222`).

Measured through `__dev.probe().render` on the system Chrome (software GL, but
these counts do not depend on the rasteriser):

| scene | draw calls | triangles | programs | textures | geometries |
| --- | --- | --- | --- | --- | --- |
| flats (race, one ship) | 44 | 1 454 | 40 | 31 | 16 |
| battle arena (one ship) | 118 | 12 436 | 57 | 32 | 65 |

Forty-four draw calls for a whole track is what instancing looks like when it
works, and the arena's 118 is still modest. Programs are the shader-permutation
count; the dev-only `[render inventory]` console line reports six materials on
flats, so most of the forty belong to the post chain and the HUD. Textures at
31 with one ship on screen is the baseline R3's fix is measured against.
`dev:console` over six seconds reported zero errors and no context loss. Two
console lines are worth knowing: Rapier's compat glue warns `using deprecated
parameters for the initialization function` on `module.init()`
(`packages/physics/src/rapier.ts:26`), harmless until a rapier bump changes the
signature; and ANGLE-on-SwiftShader logs `GPU stall due to ReadPixels`, which
is the software compositor — nothing in the engine or in `threejs-scene` calls
`readPixels`.

The measured counterpart to the list above is the allocation-timeline protocol
in `battle-allocation-profile.md`; keep it as the acceptance test for anything
in §3.3 that claims to remove an allocation.

### 3.3 Findings, ranked

Impact is what the fix buys (GPU ms, VRAM, GC, main-thread ms). Effort is S/M/L.
"Gate" names the check that proves the change is safe, and a **sim gate** means
both replay harnesses must produce the same hash before and after.

#### R1 · MSAA is paid for and discarded, and nothing anti-aliases the frame

`threejs-scene`'s `createRenderer` defaults to `antialias: true`, and the scene
config at `packages/engine/src/scenes/base.ts:364` does not override it. But the
architecture puts `postProcessing` last in every mode, and three's
`EffectComposer` (which `threejs-scene/modules/post/composer.js` wraps) renders
the scene into `new WebGLRenderTarget(w, h, { type: HalfFloatType })` with no
`samples` (`three@0.185.1`, `examples/jsm/postprocessing/EffectComposer.js:69`)
— so every triangle is drawn into a non-multisampled target and only
the final full-screen quad reaches the multisampled default framebuffer. The
post chain in `packages/engine/src/render/post.ts:173-217` is anamorphic → DoF
→ radial blur → LUT → chromatic aberration → grade; **no FXAA, SMAA or TAA
pass**, although the library ships all three
(`node_modules/threejs-scene/dist/modules/post/webgl/{fxaa,smaa,traa}.js`).

Fix: set `antialias: false`; append an SMAA (or FXAA on the low tier) pass
**directly to `ctx.composer` after `OutputPass`** — the `effects` hook inserts
before tonemapping, and edge AA wants the tonemapped image — and size it from
the existing `onResize` hook. Impact **M** (real edge AA for the first time, and
a multisampled default framebuffer nobody draws into is released). Effort **S**.
Gate: none for determinism; verify with a `dev:shot` edge crop before/after and
`renderer.info.render.calls` (+1) via `__dev.probe()`.

#### R2 · Depth of field renders through a full-resolution HalfFloat target

`DofPass` allocates `WebGLRenderTarget(width, height, { type: HalfFloatType })`
plus a copy quad (`packages/engine/src/render/dof-pass.ts:153-158`) and is
active on quality level 2. At 1080p that is ~16 MB of VRAM and a full-screen
blur fill at full rate for an effect whose output is, by definition, blurred.
Fix: construct and resize the working target at half width and height; the
depth texture it samples stays full-res. Impact **M** (≈ 4× less VRAM and
fill on the tier that pays for it). Effort **S**. Gate: `dev:shot` at level 2.

#### R3 · Every ship instance clones every texture

`cloneGltfObject` clones the geometry (needed, hull-deform writes vertices) and
then `cloneMaterialWithTextures` clones **each texture** per instance
(`packages/engine/src/assets/ship-loader.ts:53-79`). A twelve-ship race on one
hull holds twelve resident copies of the same base-colour, roughness and normal
maps. Fix: share `Texture` objects across instances of the same hull; keep
per-instance materials only where a uniform actually differs. Impact **M**
(VRAM scales with distinct hulls, not lobby size). Effort **M**. Gate:
`renderer.info.memory.textures` via `__dev.probe()` with N same-hull bots.

#### R4 · A bad-RTT correction can replay 32 frames synchronously

`replayInput` (`packages/engine/src/net/prediction.ts:455-473`) replays every
unacknowledged frame — up to `MAX_INPUT_FRAMES = 32`
(`packages/net/src/rates.ts:47`) — each a `stepHovercraft` and, for all but the
last, a `world.step()`, inside one render frame. It only fires when the
correction tier is not `'none'`, so this is a tail spike after packet loss or
a backgrounded tab, not steady-state cost. **Do not shrink the cap**: a smaller
tail trades a rare hitch for common, visible under-correction on the next
snapshot. Fix: `NODE_ENV`-gated timing around the loop and a `__dev` counter
for burst length × wall time, so the spike is visible in `dev:console` rather
than inferred. Impact **M** (bounds a real but rare main-thread spike). Effort
**M**. Gate: `engine/test/prediction.test.ts`; the replay harnesses never
execute this path.

#### R5 · The HUD builds a cache key string before checking it

`HudPanel.render()` composes a template string every call
(`packages/engine/src/hud/panel.ts:213-214`) and only then compares it to the
last key. Compare the four primitives first and concatenate only when a redraw
is happening. Impact **L** (seven panels at ≤ 20 Hz). Effort **S**. Gate:
allocation timeline shows no string allocation when idle.

#### R6 · Transports rebuild their index Maps on every snapshot

`frame()` in `packages/engine/src/battle/transport.ts:245-361` and
`race/transport.ts:186-273` rebuilds roughly nine Maps and four arrays per new
snapshot (30 Hz, bounded). They are scaffolding discarded wholesale each time,
so `clear()` and refill in place after a retention audit; leave leaf view
objects fresh unless the audit proves nothing holds them. Impact **M** at
sixteen players in battle, otherwise **L**. Effort **M**. Gate: retaining
stacks under `renderremotes`/`renderworld` in the allocation profile.

#### R7 · The quality controller looks for LOD objects that do not exist

`packages/engine/src/quality/runtime.ts:140-146` traverses for `THREE.LOD` on
each stage transition; there is no `THREE.LOD` anywhere in the scene graph.
Delete the branch, or wire real LODs for ships and props and keep it. Impact
**L** (dead code, infrequent). Effort **S**.

#### R8 · One allocation left in `stepHovercraft`

`const padLift = [ 0, 0, 0, 0 ]` at `packages/physics/src/vehicle-step.ts:416`
is a fresh array per call — per predicted tick, per replayed frame, and per
ship per server tick. Hoist it to module scope **and `fill(0)` at the top of
the function**: every write to `padLift[i]` is gated by `padHit[i]`, so a bare
hoist would carry last tick's lift into a pad that has just left the ground —
a physics bug, not a GC nit. Impact **L** alone, multiplied by R4's replay
depth and by server ship count. Effort **S**. **Sim gate.**

---

## 4. Netcode and server

### 4.1 The wire, and what it costs

Two channels carry a match (`AGENTS.md`, "Two channels carry a match"):
`@colyseus/schema` at 20 Hz for roster, score, lap and status, and the
bit-packed snapshot in `packages/net` at 30 Hz for poses. Neither field on the
Schema side is `.unreliable()`; both `state.ts` files document trying it and
reverting, because over WebSocket such a field is never patched at all.

**Snapshot, per ship** (`packages/net/src/codec/ship-state.ts:25-44`,
`quantize.ts`): position 3 × 18 bits, quaternion 32 bits (smallest-three),
linear velocity 3 × 16, angular velocity 3 × 12, health 8, flags 8,
`respawnIndex` 8, aim 12, plus a 16-bit id, a full/delta bit and an 8-bit
change mask. Measured (`AGENTS.md`): **30.3 B full, 11.3 B delta.**

**Snapshot envelope** (`packages/net/src/codec/snapshot.ts:44-48`): `serverTick`
32 + `serverTimeMs` **as a float64** 64 + `baselineTick` 32 +
`lastProcessedInput` 32 + count 16 = 176 bits = 22 B per snapshot.

**Input packet** (`packages/net/src/codec/input.ts:63-84`): header `lastAck` 32
+ `interpTick` 32 + count 8 = 72 bits; per frame `seq` 32 + `clientTick` 32 +
three 10-bit axes + two 8-bit levels + buttons 8 + `resetSeq` 8 = 126 bits.
Every packet re-sends the whole unacknowledged tail, on purpose: a `dirty`
flag once sent a held throttle exactly once and a dropped packet left the
server driving on stale input indefinitely.

Steady-state cost per client, from those widths (WebSocket framing excluded):

| ships in room | down, all-delta (22 + n × 11.3 B) × 30 Hz | down, full snapshot (join or lost baseline) |
| --- | --- | --- |
| 2 | 1.3 KB/s | 83 B |
| 8 | 3.4 KB/s | 264 B |
| 12 | 4.7 KB/s | 386 B |
| 16 | 6.1 KB/s | 507 B |

`AGENTS.md` measured 5.3 KB/s at 16 ships, consistent with idle ships producing
near-empty masks.

| unacknowledged tail | up today (72 + n × 126 bits) × 60 Hz | up after trims (§7 item 10: `seq`/`clientTick` 16-bit) |
| --- | --- | --- |
| 1 frame | 1.5 KB/s | 1.2 KB/s |
| 2 frames | 2.4 KB/s | 1.9 KB/s |
| 5 frames (≈ 50 ms RTT) | 5.3 KB/s | 4.1 KB/s |
| 8 frames | 8.1 KB/s | 6.2 KB/s |

The tail length is roughly RTT ÷ 16.7 ms plus two, because acknowledgements
ride on snapshots every second tick. Two things follow. **Upload is
RTT-dependent and can exceed download in a small room**, which nobody had
written down. And the codec's quantisation discipline slips in exactly two
places — the float64 `serverTimeMs` and the two full 32-bit counters per input
frame — which together are the only bandwidth work worth doing (§7 item 10).

`MessageKind` (INPUT/SNAPSHOT/EVENTS/PING/PONG) is declared three times with
identical literals: `packages/race/src/room.ts:39-45`,
`packages/battle/src/room.ts:39-45`, `packages/engine/src/net/room-link.ts:45-51`.
Not yet drifted; a single export in `Ξ` keeps it that way.

### 4.2 Server tick cost and the rooms-per-process ceiling

Both rooms drive a fixed-step accumulator from `setSimulationInterval` at
`TICK_HZ = 60` and patch Schema at 20 Hz (`setPatchRate(50)`); snapshots go out
every second tick. One Rapier world per room, freed in `sim.dispose()`; the
WASM module is shared. §1.4 measures the simulation half of a tick headless.

The formula the report uses, and why it is shaped this way:

```
roomsPerProcess = floor(16 667 µs × 0.6 ÷ tick_p95_µs)
```

Bun is single-threaded, so every room on a process shares one event loop and
a slow tick in room A delays room B's scheduled tick in the same period —
tail latency, not the mean, sets the ceiling. The 0.6 leaves headroom for GC,
OS jitter, snapshot encoding and Colyseus's own patch serialisation, none of
which the headless number includes. "Rooms per core" only becomes a meaningful
unit once the server runs one process per core behind a shared presence
store; today there is one `bun src/index.ts` and no Redis, so the report says
**rooms per process**.

The simulation numbers in §1.4 are small — 71 rooms per process at sixteen
battle ships from the sim alone, 206 at a full twelve-racer grid. That is the
finding: when the sim is a rounding error, the tick budget is being spent in
what surrounds it — Schema patch encoding, `buildSnapshot`, the two object
trees §4.3 N5 describes, WebSocket writes — and none of that is measured
anywhere. The super-linear growth in the same table is the other half: it is
N4's per-player `hitCandidates()` rebuild and the pairwise contact and splash
loops, which is why the roadmap measures first (item 8) and cuts second (item
9), so the second number can be read against the first. §7 item 8 adds a ring
buffer of `sim.step()` durations per room and exposes p50/p95/max on the
existing `/health` route (`packages/server/src/index.ts:97`), isolating the
simulation from the transport so the next optimisation is aimed at the right
half.

### 4.3 Findings, ranked

#### N1 · The client never reconnects

Both rooms call `allowReconnection(client, RECONNECT_GRACE_SEC)` with a 15 s
grace (`packages/race/src/room.ts:48,146`, `packages/battle/src/room.ts:48,159`).
The client binding, `packages/engine/src/net/room-link.ts`, registers `joined`,
`onStateChange` and the three binary message handlers — and **no `room.onLeave`,
no `.reconnect(token)`**. `linkError` is set only on the initial join failure
(`:181-190`); `stats().snapshotAgeMs` (`:428`) is computed and read by nothing.
A Wi-Fi blip or a backgrounded phone ends the match silently, with the server
still holding the seat. Fix: `onLeave` → `reconnect(reconnectionToken)` with
backoff, a "reconnecting" HUD state driven by `snapshotAgeMs`, and a
`@colyseus/testing` test that force-closes the socket and asserts recovery
inside the grace window. Impact **H**. Effort **M**. No sim gate.

#### N2 · The room monitor is on unless someone remembers to turn it off

`devTools` defaults to `NODE_ENV !== 'production'`
(`packages/server/src/config.ts:48`) and mounts `/colyseus` (live rooms and
players, no auth) and `/playground` (join any room). The server starts as a
bare `bun src/index.ts`; there is no Dockerfile, `fly.toml`, `Procfile` or
`render.yaml` in the repo to bake `NODE_ENV=production` in. Fix: default
`devTools` to **off** behind an explicit `COLYSEUS_DEVTOOLS=1`, and commit one
deploy artefact that sets `NODE_ENV`. The first `server` test asserts the
default with no environment at all. Impact **M-H** (ops exposure). Effort **S**.

#### N3 · Nothing is rate-limited, and a direct join can name itself anything

No throttle middleware exists on `/api/register`, `/api/game/ticket` or room
creation. `options.name` is used verbatim on a ticketless join
(`packages/race/src/room.ts:112`, `packages/battle/src/room.ts:125`); only the
ticket route slices to 24 characters, so a hand-rolled client can put an
arbitrarily long name into the Schema roster every other client patches. Fix:
token bucket per IP on the two routes and on `onCreate`; clamp `name` at the
room layer. Impact **M**. Effort **S-M**.

#### N4 · Battle rebuilds the hit-candidate list three times per player per tick

`hitCandidates()` maps `this.players` into fresh objects
(`packages/battle/src/sim.ts:217-223`) and is called from the lock scan
(`:564`), the hitscan pass (`:645`) and blast resolution (`:797`), inside
per-player loops — O(n²) small-object churn at up to sixteen players, worse in
a fire-fight than on an idle grid, and it runs on the server **and** inside
client prediction. Fix: build the list once at the top of `step()` and pass it
down. Impact **M-H**. Effort **M**. **Sim gate.**

#### N5 · Two representations of every tick are built per broadcast

`BattleSim.snapshot()` (`packages/battle/src/sim.ts:1035-1088`) and
`RaceSim.snapshot()` (`packages/race/src/sim.ts:411-420`) build a nested object
tree via `.map()` on each 30 Hz broadcast, used only to feed the Schema sync
(`battle/room.ts:263`, `race/room.ts:232`) — alongside the bit-packed
`battleSnapshotOf`/`raceSnapshotOf` built on the line above. Derive the Schema
fields from the same pass. Hash-safe (the replay trace samples poses, not this
object). Impact **L-M**. Effort **M**.

#### N6 · Codec slips

`writeFloat64(snapshot.serverTimeMs)` (`packages/net/src/codec/snapshot.ts:45`)
spends 8 bytes where a `u32` millisecond offset does; `seq` and `clientTick`
are full 32-bit per input frame (`input.ts:72-73`) where 16-bit wraparound
counters are conventional. See §4.1 for what it buys. **Codec gate**, not sim
gate: the replay harnesses hash sim state, not wire bytes, so the safety net
is `packages/net/test/codec.test.ts`, which already round-trips
`encodeSnapshot`. Impact **L-M**. Effort **S**. Separate PR — it changes the
wire format.

#### N7 · No Next.js error, loading or not-found boundaries

`find src/app -name 'error.tsx' -o -name 'loading.tsx' -o -name 'not-found.tsx'`
returns nothing. An uncaught render error in any route falls through to Next's
default page. Impact **M** (player-facing, cheap). Effort **S**.

#### What is right here

The room lifecycle is correct: `onDispose` records the match then frees the
world; no interval or listener outlives a room; a malformed packet is refused,
not fatal (`decodeInput` in a try/catch in both rooms). Database calls sit only
in `onDispose`/`recordResult`, never per tick or per join; the join ticket is a
signed JWT with no round trip; passwords are scrypt with a dummy-hash path so
login timing does not enumerate users (`packages/data/src/auth/`). The canvas
mounts in a `useEffect` with WebGL context-loss recovery and explicit
`forceContextLoss()` on unmount; telemetry reaches React at 15 Hz, never 60.

---

## 5. Architecture and DX

### 5.1 Race and battle duplicate each other in four places

Identical non-trivial lines after whitespace normalisation, brace-only and
blank lines removed:

| pair | A lines | B lines | identical normalised lines | share of the shorter file |
| --- | --- | --- | --- | --- |
| `race/src/room.ts` ↔ `battle/src/room.ts` | 261 | 301 | 73 | 28 % |
| `engine/src/race/transport.ts` ↔ `engine/src/battle/transport.ts` | 278 | 366 | 57 | 20 % |
| `race/src/input.ts` ↔ `battle/src/input.ts` | 37 | 47 | 9 | 24 % |
| `race/src/snapshot.ts` ↔ `battle/src/snapshot.ts` | 60 | 65 | 8 | 13 % |
| `race/src/dev/replay.ts` ↔ `battle/src/dev/replay.ts` | 223 | 235 | 22 | 10 % |
| `engine/modules/publish.ts` ↔ `publish-battle.ts` | 92 | 172 | 2 | 2 % |

These are floors — identical lines after normalisation, not similarity — and
three of the pairs are deliberate. `input.ts` is duplicated to avoid a race →
battle dependency and says so. The two `room.ts` files share the most lines
because a Colyseus room has a fixed shape (`onCreate`, `onJoin`, `onLeave`,
`drive`); their genuinely shared logic (`pongFor`, `runReplayCli`) already
moved to `Ξ`, and a base class for the rest would save seventy lines at the
cost of a third place to look. `publish.ts` and `publish-battle.ts` share a
name and nothing else. The one worth building is the transport base
(`cleanup-analysis.md` §2.1): both
`engine/src/{race,battle}/transport.ts` carry the same ten one-line delegates
onto `RoomLink` and the same memoised merge-frame pattern. Extract
`engine/src/net/mode-transport.ts`; the regression net is
`engine/test/prediction.test.ts`, which runs a real room against the real
prediction.

### 5.2 God files

The HUD is the one place the previous ledger's fix did not land and the files
kept growing (see §2.3). `drawRacePanels`/`drawBattlePanels` are still one
function each, switching on panel name, instead of a
`Record<HudPanelKey, PanelPainter>` per mode. `packages/game/src/battle.ts` is
a composition root that implements — pools, opponents and the post chain are
already extracted beside it, yet it is 615 lines against a 250-line target.
`BattleSim` is 1 089 lines with four pure subsystems already lifted out; the
next extraction should wait for N4, so nothing is moved while still O(n²).
`vehicle-step.ts` at 701 lines is long because it is one tick written top to
bottom — sense, control, allocate, apply — and the comments are the handling
model; it is the one file on this list where splitting would cost more than it
saves.

Add `max-lines: 500` (warn) so the next 800-line file is a decision, not a
drift.

### 5.3 Lint and types

Type discipline is a strength to protect: four `any` types, all around the
dev bridge in `engine` and each with a `no-explicit-any` disable beside it;
zero `@ts-ignore`/`@ts-expect-error`; `strict: true`. Warnings are another
story: 121 today against 63 when the last ledger looked, with no ratchet in
between. The shared config (`@tuomashatakka/eslint-config`) turns
**off** `no-unused-vars` and `ban-ts-comment`, so neither is enforced — knip
(§5.4) covers the first; the second has nothing to catch today.

| scope | `any` types | `eslint-disable` | `@ts-ignore` / `@ts-expect-error` | non-null `!` |
| --- | --- | --- | --- | --- |
| `src/`, core, data, physics, race, server, state | 0 | 0 | 0 | 0 |
| battle | 0 | 0 | 0 | 1 |
| engine | 4 | 6 | 0 | 3 |
| game | 0 | 0 | 0 | 1 |
| net | 0 | 0 | 0 | 0 |
| ui | 0 | 0 | 0 | 1 |

The `any`s: `engine/src/types.ts:8` (`App<any>`) and `engine/src/scenes/base.ts:520,541,552` (`as any` around the dev bridge). The disables: `no-explicit-any` beside each of those plus a block in `engine/src/net/room-link.ts:25`, and one `max-statements` in `engine/src/battle/arena-visuals.ts:166`. A grep for `any` also hits a comment in `net/src/prediction.ts:7` and a variable literally named `any` in `engine/src/fx/afterburner.ts:218`; neither is a type.

Warnings by rule and by file at `34661ed`:

| warnings | rule |
| --- | --- |
| 22 | `complexity` |
| 21 | `import/no-extraneous-dependencies` |
| 19 | `max-statements` |
| 13 | `@stylistic/key-spacing` |
| 9 | `whitespaced/aligned-assignments` |
| 8 | `react-strict/no-nested-divs` |
| 7 | `react-strict/prefer-no-use-effect` |
| 6 | `react-strict/no-style-prop` |
| 4 | `@stylistic/padding-line-between-statements` |
| 4 | `@stylistic/object-curly-spacing` |
| 2 | `@stylistic/lines-around-comment` |
| 2 | `@stylistic/padded-blocks` |
| 1 | `max-lines` |
| 1 | `react-strict/no-complex-jsx-map` |
| 1 | `import/newline-after-import` |
| **121** | |

Thirty-six of these are auto-fixable (`eslint --fix`), which is the whole stylistic block. Twenty-one are `import/no-extraneous-dependencies`; check whether that rule understands the glyph `paths` before ratcheting — a warning that is the linter's misunderstanding should be configured away, not counted.

| warnings | file |
| --- | --- |
| 13 | `test/api-auth.test.ts` |
| 10 | `packages/engine/src/hud/types.ts` |
| 6 | `packages/engine/test/wreck-slice.test.ts` |
| 4 | `packages/ui/src/hangar/hangar-controls.tsx` |
| 4 | `src/app/hangar/page.tsx` |
| 3 | `packages/battle/src/sim.ts` |
| 3 | `packages/engine/src/hud/materials.ts` |
| 3 | `packages/engine/src/scenes/base.ts` |
| 3 | `packages/game/src/battle.ts` |
| 3 | `packages/ui/src/main-menu.tsx` |
| 2 each | `battle/src/state.ts`, `battle/test/sim.test.ts`, `engine/src/hud/instruments.ts`, `engine/src/hud/sight.ts`, `engine/src/hud/spatial-hud.ts` |

The ratchet: `--max-warnings <today's count>` in the `lint` script, lowered in
each PR that removes some; `max-lines: 500`; and `complexity`/`max-statements`
left as warnings so the count is the metric, not a gate that invites a
disable comment.

### 5.4 Dead code

Eighteen exports with no importer anywhere (`rg -lw NAME` over `*.ts`, `*.tsx`, `*.mjs`, minus the declaring file):

| symbol | declared at |
| --- | --- |
| `INPUT_HZ`, `REWIND_HISTORY_MS` | `packages/net/src/rates.ts:24,43` |
| `ARENA_HALF` | `packages/battle/src/arena.ts:121` |
| `isLevelId` | `packages/core/src/levels.ts:37` |
| `clearTrace` | `packages/engine/src/dev/trace.ts:142` |
| `disposeShipObject` | `packages/engine/src/ship/icaras-generated.ts:174` |
| `drawGroupRule` | `packages/engine/src/hud/chrome.ts:231` |
| `drawSpeedTape` | `packages/engine/src/hud/instruments.ts:219` |
| `halfWidthAt` | `packages/engine/src/ship/hull-profile.ts:261` |
| `HUD_FONT`, `HUD_BAR_GAP`, `HudThemeColor` | `packages/engine/src/hud/tokens.ts:13,136,89` |
| `preloadShip` | `packages/engine/src/assets/ship-loader.ts:274` |
| `resetTelemetry` | `packages/engine/src/telemetry.ts:79` |
| `ScenarioEvent`, `ScenarioStep` | `packages/engine/src/dev/types.ts:50,58` |
| `SHIP_MATERIALS` | `packages/engine/src/ship/materials.ts:609` |
| `tickHolo` | `packages/engine/src/hud/materials.ts:108` |

`bunx knip --no-progress --reporter compact` ran without a config: 0 unused files, 2 unused exports (`signIn`, `signOut` in `src/lib/auth.ts`), 1 duplicate export (`HUD_FONT_MONO` / `HUD_FONT`), and 62 "unused dependency" flags. Most of the 62 are the `@crash-velocity/*` workspace entries — false positives, because imports resolve through glyph `paths` knip cannot see. The real ones underneath: `zod` in `net` and `data`, `drizzle-zod` in `data`, `@colyseus/schema` declared in `engine` (it imports the Schema classes from `race`/`battle` instead), `threejs-scene` declared in `ui`, `jose` at the root and in `server` (used in `data`), and `vitest` plus `@colyseus/testing` as `server` devDependencies for a package with no tests. Adopting knip as a CI gate (§7 item 13) therefore starts with a `paths` mapping for the glyphs; without it sixty false positives bury the handful of real findings.

`src/components/` and `src/engine/` are empty apart from `.DS_Store`, absent
from `AGENTS.md`'s layout table, and safe to delete.

### 5.5 Dependencies

`zod` is declared in `net` and `data`, `drizzle-zod` in `data`; none is
imported. `server` declares `vitest` and `@colyseus/testing` as
devDependencies and has no tests. `engine` declares `@colyseus/schema` but
imports the Schema classes from `race` and `battle`. `vitest` is `^4.1.10` at
the root and `^4.1.11` in five packages, which gives five nested copies of the
runner. `three` is a dependency in five packages and a peer in four; fine, but
one version everywhere is worth a lockfile check after every bump. No bundle
analyzer is configured; `next.config.mjs` is `transpilePackages` and nothing
else — and with Turbopack, which prints no per-route size table, the analyzer
is the only way to see first-load JS at all.

### 5.6 Tests

| package | test files | ≈ tests (`it(`/`test(` count) |
| --- | --- | --- |
| engine | 12 | 69 |
| battle | 4 | 57 |
| net | 3 | 35 |
| ui | 3 | 31 |
| race | 4 | 27 |
| data | 2 | 18 |
| physics | 4 | 18 |
| core | 1 | table-driven, undercounted |
| root `test/` | 1 | table-driven, undercounted |
| **game** | **0** | **0** |
| **server** | **0** | **0** |
| **state** | **0** | **0** |
| all (vitest) | 34 | 371 |

Three packages have none. In order of leverage:

1. **`state`** — every HUD and tuning read depends on `defineStore`. First
   test: `select` fires exactly once per relevant field change; the
   `localStorage` envelope round-trips a `RaceState`/`BattleState` shape.
2. **`server`** — first test: `loadConfig()` defaults `devTools` to false with
   no environment (the regression net for N2), parses `RACE_GRID_BOTS`, throws
   on garbage. Plain vitest; nothing here touches a Bun builtin.
3. **`game`** — after the `battle.ts` extraction, not before; testing a
   615-line composition root locks in the wrong shape. Test the pieces already
   beside it (`opponents.ts` add/remove lifecycle, `publish-battle.ts`'s 15 Hz
   throttle) and add a construct-without-throwing smoke test for `mountBattle`.

### 5.7 Tooling

`bun run typecheck` is twelve serial `tsc -p` invocations; TypeScript project
references would make it incremental and parallel, but they interact with the
glyph generator that currently *is* the DAG enforcement. Time-box a two- or
three-package proof of concept before committing. A bundle analyzer behind an
environment flag is a five-line change and belongs in the same PR. CI is
already the right shape; the ratchets in §5.3 and a `knip` step are the
additions.

### 5.8 Documentation drift

- `AGENTS.md` says battle's post chain is `packages/engine/src/battle/post.ts`;
  the pass list, quality ladder and the two documented traps moved to
  `packages/engine/src/render/post.ts`, and `battle/post.ts` keeps only battle's
  grade tint.
- `packages/net/src/channels.ts` (msgpackr) is missing from the layout table.
- Three present-tense "zustand" comments describe stores that are
  `threejs-scene` stores: `src/app/hangar/page.tsx:12`,
  `packages/engine/src/modules/publish.ts:14,17`,
  `packages/game/src/hangar.ts:257`.
- Empty `src/components/` and `src/engine/`.

`docs-sync`'s own protocol — every backticked path checked with `test -e` — is
the fix.

---

## 6. Load and assets, briefly

Out of the report's weighting by request; recorded because the build ran.

Next 16 on Turbopack prints the route list but not the classic per-route "First Load JS" table, so a bundle analyzer (§7 item 21) is the only way to get that figure; the filesystem numbers below are the honest substitute.

| route | kind |
| --- | --- |
| `/`, `/_not-found`, `/battle`, `/crash-lab`, `/editor`, `/hangar`, `/lobby` | static |
| `/levels/[level]` | dynamic |
| `/api/auth/[...nextauth]`, `/api/game/ticket`, `/api/register` | dynamic |

`.next/static` totals 5.4 MB. The twelve largest chunks:

| KB | chunk | what it is |
| --- | --- | --- |
| 2 228 | `1tuuabzaotkyf.js` | Rapier WASM (`rapier_wasm3d_bg`) inlined as base64 by the `-compat` build. Dynamic-imported and single-flighted, so it is **not** on the first-load path — but it is 40 % of all static bytes and cannot shrink without leaving the compat build |
| 348 | `3-q79owfphz90.js` | — |
| 264 | `07y5yu00o_pc5.js` | — |
| 228 | `2o1efi5b5t0ek.js`, `2nia2dhljw0yo.js`, `2kdv0j-tmi5hy.js`, `18um9pfcz78l3.js` | four chunks of identical size, worth identifying with the analyzer |
| 224 | `2nykiepra7i1k.js` | — |
| 160 | `2e0ivaj4kpu3a.js`, `0iqthj5wa7evv.js` | — |
| 140 | `11oof8oxnxiv9.js` | — |
| 120 | `3uxhxvavsyg_n.js` | — |

Bundle leak greps after the build: all six clean — `__dev`, `colyseus/core`, `drizzle-orm`, `@neondatabase`, `pglite`, `zustand` — so the package boundaries held through this build.

| `public/` entry | size |
| --- | --- |
| `spaceship_-_cb1/` | 33 MB — `Material_metallicRoughness.png` 13 MB, `scene.bin` 8.8 MB, `Material_baseColor.png` 7.2 MB, `Material_normal.png` 3.1 MB |
| `textures/` | 20 MB — two hangar backdrops at 3.8 MB each, plus 1–2.4 MB normal/emissive/roughness maps |
| `ships/` | 6.1 MB of FBX |
| `icaras/` | 2.2 MB (textures only, after the last purge) |
| **total** | **61 MB** |

No `DRACOLoader`, `KTX2Loader` or `MeshoptDecoder` exists in the repo;
`public/` is almost entirely uncompressed PNG plus an 8.8 MB `.bin`.
`cleanup-analysis.md` §1.1 has the plan (Draco/meshopt for
`spaceship_-_cb1`, KTX2 or WebP for the hangar backdrops, a `public/` byte
budget in CI). Rapier WASM is already dynamic-imported and single-flighted.

---

## 7. Roadmap

> **Status, 2026-09-18 (same day, on `main`).** Phases 1 and 2 were executed
> from this section; the gates held (0 type errors, 0 lint errors under the
> committed toolchain, 425 tests, all eight replay hashes unchanged, leak greps
> empty).
>
> | item | state | commit |
> | --- | --- | --- |
> | 1 client reconnection | landed | `44fe9d4` |
> | 2 devtools fail-closed, Dockerfile, first server test | landed | `3364b18` |
> | 3 rate limits, name clamp, per-IP join limiter | landed | `2693192` |
> | 4 AA pass, half-res DoF, dead LOD branch | landed | `9215731` |
> | 5 doc drift | landed | with this note |
> | 6 lint ratchet | deferred | an eslint-config bump (4.0.1 → 4.1.0) sits uncommitted in the tree and moves the count; ratchet once it lands |
> | 7 Next boundaries | landed | `278dcb3` |
> | 8 tick histogram on `/health` | landed | `cc00a70` |
> | 9 sim allocation cuts; Schema synced from live state | landed | `951ef2e`, `cc00a70` |
> | 10 codec trims | landed | `bff82bb` |
> | 11 one `MessageKind` | landed | `cc00a70` |
> | 12 replay-burst instrumentation | landed | `353791a` |
> | 13 hygiene | GC nits landed (`353791a`); knip, dead exports, zod removal, vitest alignment deferred with item 6 (manifest changes, one lockfile touch) | |
> | 14 Tier-3 | clock injection (`bff82bb`) and the `STEP` tripwire (`test/step-consistency.test.ts`) landed; `AnyApp` typing deferred | |
> | 15 mode-transport base | landed | `353791a` |
> | 16 first `state` and `server` tests | landed | `packages/state/test`, `3364b18` |
> | 17–21 (Phase 3) | not started | |
>
> Also open: the within-range `bun audit fix` (Next 16.2.9 carries two critical
> advisories fixed in 16.3.3, inside the caret range) — a lockfile-only change
> that the build must gate.

Two gating classes, kept distinct because the replay hashes sample **sim
state**, not wire bytes:

- **sim gate** — `bun run dev:scenario` for all six race scripts and
  `bun run dev:replay` for both battle scripts produce the same hashes before
  and after. Anything under `packages/physics`, `packages/race/src/sim.ts`, or
  battle tick code.
- **codec gate** — `packages/net/test/codec.test.ts`, extended with the new
  widths and boundary values. Anything under `packages/net/src/codec`. The
  replay suite does **not** cover it.

Owning agents are the repo's own (`.claude/agents/`): `refactor-mechanic` for
mechanical single-package changes, `sim-surgeon` for anything behind the sim
gate, `docs-sync` for documentation, `verifier` for the ladder. `hud-artist` is
for visual briefs; the HUD split below is mechanical, so it goes to
`refactor-mechanic`, and the orchestrator owns the screenshot parity check
that neither agent's brief includes.

### Phase 1 — stop the bleeding

Goal: nothing fails silently and nothing ships fail-open. Gate: verifier
ladder green plus the two new tests.

| # | item | files | impact | effort | gate | agent |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Client reconnection: `onLeave` → `reconnect(token)` with backoff; "reconnecting" HUD state from `snapshotAgeMs` | `engine/src/net/room-link.ts`, both transports, `hud/` | H | M | `@colyseus/testing` drop-and-recover test | — |
| 2 | Fail-closed devtools (`COLYSEUS_DEVTOOLS=1` opt-in) + one deploy artefact setting `NODE_ENV=production` | `server/src/config.ts`, new `Dockerfile` | M-H | S | first `server` test | refactor-mechanic |
| 3 | Rate limit `/api/register`, `/api/game/ticket`, `onCreate`; clamp `options.name` at the room | `src/app/api/*`, both `room.ts` | M | S-M | route test for 429; name-clamp unit test | — |
| 4 | R1 + R2 + R7: SMAA/FXAA after `OutputPass`, `antialias:false`, half-res DoF target, delete the LOD branch | `render/post.ts`, `render/dof-pass.ts`, `scenes/base.ts:364`, `quality/runtime.ts` | M | S | `dev:shot` edge crop; `renderer.info` | — |
| 5 | Doc drift (§5.8) and the two empty directories | `AGENTS.md`, four comment lines | M | S | `test -e` every path | docs-sync |
| 6 | Lint ratchet: `--max-warnings` at today's count, `max-lines: 500` | `package.json`, `eslint.config.mjs` | M | S | CI fails above the count | refactor-mechanic |
| 7 | N7: `error.tsx`, `loading.tsx`, `not-found.tsx` | `src/app/` | M | S | route smoke | — |

### Phase 2 — measure, then cut

Goal: server cost is a number, and the cheap duplication and hygiene debt is
gone. Gate: `/health` reports a stable p95 at sixteen ships, all hashes
unchanged, warnings under the ratchet, codec test green.

| # | item | files | impact | effort | gate | agent |
| --- | --- | --- | --- | --- | --- | --- |
| 8 | Tick histogram: ring of `sim.step()` durations per room; p50/p95/max on `/health` | both `room.ts`, `server/src/index.ts:97` | M | S | non-zero `tickP95Us` under load | — |
| 9 | N4 + R8 + N5: cache `hitCandidates()` once per tick; hoist `padLift` **with `fill(0)`**; derive Schema sync from the snapshot pass | `battle/sim.ts`, `physics/vehicle-step.ts:416`, `race/sim.ts` | M-H | M | **sim gate**; p95 drops vs item 8 | sim-surgeon |
| 10 | N6 codec trims: `serverTimeMs` → u32 offset; `seq`/`clientTick` → 16-bit wraparound | `net/src/codec/{snapshot,input}.ts` | L-M | S | **codec gate**; separate PR | refactor-mechanic |
| 11 | One `MessageKind` export in `Ξ` | three files | M | S | typecheck; single definition | refactor-mechanic |
| 12 | R4: instrument the replay burst; do not cap it | `engine/src/net/prediction.ts` | M | M | `prediction.test.ts`; `dev:console` p99 under loss | — |
| 13 | Hygiene: adopt `knip`; prune the dead exports; drop `zod`/`drizzle-zod`; one vitest version; R5 primitive compare; R6 Map reuse after a retention audit | `engine/hud/panel.ts`, both transports, three `package.json` | L-M | M | knip clean; allocation profile | refactor-mechanic |
| 14 | Tier-3 sweep: inject a clock into `buildSnapshot`/`pongFor`; type the mount contract and delete `AnyApp`; add root `test/step-consistency.test.ts` asserting `Φclock.STEP === Ξrates.STEP` (leaves may not import each other, so a tripwire replaces the import) | `net/src/codec/snapshot.ts`, `net/src/room-clock.ts`, `ui/src/scene-canvas.tsx`, `test/` | L | S | codec test; new test | refactor-mechanic |
| 15 | Transport base `engine/src/net/mode-transport.ts` (ledger 2.1) | both transports | M | M | `prediction.test.ts` | refactor-mechanic |
| 16 | First tests for `state` and `server` (§5.6) | `packages/state/test`, `packages/server/test` | M | S | they exist and run under vitest | refactor-mechanic |

### Phase 3 — structural

Goal: the two remaining god-file clusters shrink under hash- and
screenshot-gated passes. Gate: HUD files individually under ~300 lines with
`dev:shot` parity; `game/src/battle.ts` under 250; the tooling spike concluded
either way.

| # | item | files | impact | effort | gate | agent |
| --- | --- | --- | --- | --- | --- | --- |
| 17 | HUD split (ledger 1.6): `Record<HudPanelKey, PanelPainter>` per mode; rename one of the two `overlay.ts` | `engine/src/hud/*` | H (conformity) | L | `dev:shot` before/after per panel; engine tests | refactor-mechanic |
| 18 | Continue the sim split (ledger 1.2) after item 9; `mountBattle` to 250 (ledger 1.4) | `battle/src/sim.ts`, `game/src/battle.ts` | M | M | **sim gate** | sim-surgeon |
| 19 | `game` tests on the extracted pieces + a mount smoke test | `packages/game/test` | M | S | run under vitest | refactor-mechanic |
| 20 | R3: share textures across same-hull instances | `engine/src/assets/ship-loader.ts` | M | M | `renderer.info.memory.textures` | — |
| 21 | Tooling spike: TS project references vs the glyph generator; bundle analyzer behind a flag | `tsconfig*.json`, `scripts/aliases.mjs`, `next.config.mjs` | M | L / S | `typecheck` wall time; analyzer report | — |

### Not in scope, by request

Draco/meshopt and KTX2 for `public/`, a `public/` byte budget in CI, and the
FBX → GLB conversion. `cleanup-analysis.md` §1.1 already specifies them.

---

## 8. Appendix

### 8.1 The commands behind every number

| number | command |
| --- | --- |
| provenance | `git rev-parse --short HEAD` · `git status --porcelain` · `sysctl -n machdep.cpu.brand_string hw.ncpu` · `bun --version` |
| ladder | `time bun run aliases:check` · `time bun run typecheck` · `bun run lint` · `time bun run test` · `time bun run build` |
| lint breakdown | `bunx eslint src packages scripts test -f json`, aggregated by `ruleId` and by `filePath` |
| determinism | `for s in straight-line hard-corner turn-response strafe-response boost-jump respawn; do bun run dev:scenario $s --json; done` · `bun run dev:replay point-blank --json` · `bun run dev:replay straight-fight --json` |
| tick cost | scratch copies of `straight-fight.json` (`bots` 0/6/14) and `straight-line.json` (`racers` × 1/2/8/12); for each, `bun run dev:replay <file> --runs 2 --json` and `--runs 50 --json`, three trials, median; µs/tick = (T50 − T2) ÷ 48 ÷ ticks × 10⁶; rooms/process = ⌊16 667 × 0.6 ÷ µs⌋ |
| bundle | `du -sh .next/static` · `find .next/static/chunks -type f -exec du -k {} + \| sort -rn \| head -12` · `for n in __dev colyseus/core drizzle-orm @neondatabase pglite zustand; do grep -rl "$n" .next/static; done` |
| size | `find <dir> -name '*.ts' -o -name '*.tsx' \| xargs wc -l` per package, `src/` and `test/` separately |
| relaxations | `rg --count-matches` for `: any\|as any\|<any>`, `eslint-disable`, `@ts-ignore\|@ts-expect-error`, `[\w\)\]]!\.` + `[\w\)\]]!\)` |
| duplication | normalise (trim; drop blank and brace-only lines) → `sort -u` → `comm -12 A B \| wc -l` |
| dead exports | `rg -lw NAME --glob '*.ts' --glob '*.tsx' --glob '*.mjs'` minus the declaring file · `bunx knip --no-progress --reporter compact` |
| assets | `du -sh public/*` · `find public -type f -size +1M -exec du -h {} +` |
| bandwidth | arithmetic on the bit widths in `packages/net/src/codec/{ship-state,snapshot,input}.ts` (§4.1) |
| render counts | `CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" bun run dev:eval -e 'JSON.stringify(__dev.probe().render)' --level flats` and `--level battle` · `bun run dev:console --seconds 6 --level flats` |

### 8.2 The determinism hash surface

Anything on this list is behind the sim gate. Reordering, vectorising or
"tidying" any of it changes the floating-point summation order or the trace,
and the hash with it.

- `THRUSTER_RIG` iteration order and the `<= 1e-4` skip guard in
  `packages/physics/src/vehicle-step.ts:566-593` — the comment says why: fixed
  rig order keeps the float accumulation bit-identical run to run.
- `Φrng` (`mulberry32`) is the only randomness; a `Math.random()` anywhere in
  `sim.ts`, `vehicle-step.ts`, `projectiles.ts` or `bot.ts` desyncs silently.
- Racer and player **array** iteration order in both `step()`s; a `Map`/`Set`
  must preserve insertion order exactly.
- The salvo fan in `packages/battle/src/projectiles.ts` is index-derived,
  never drawn from `rng`.
- World construction order and the exact `@dimforge/rapier3d-deterministic-compat`
  pin, asserted by `packages/physics/test/determinism.test.ts`.
- The replay trace's field order and quantisation in
  `packages/{race,battle}/src/dev/replay.ts`.
- A replayed frame must go through the same `toRaceInput`/`toBattleInput` the
  server applies.

### 8.3 Method and limits

- Findings come from three read-only exploration passes on a fast model,
  each spot-checked line by line by the author of this report before it was
  written; the two roadmap passes that followed corrected three of the
  original findings (the three `hitCandidates()` call sites, the codec gate
  being outside the replay suite, and the `STEP` import being impossible
  under the DAG).
- Frame-time percentiles from `dev:console` are software-rasterised
  (SwiftShader) and were not used as GPU numbers.
- Tick cost is the simulation alone, on one machine, with no network; it is a
  lower bound on server cost, which is exactly why §7 item 8 exists.
- Duplication counts are identical normalised lines, a floor on similarity,
  not a measure of it.
- No source file was changed to produce this report. `git status` after the
  run shows only `docs/`.
