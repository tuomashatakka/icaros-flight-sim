# Codebase cleanup analysis

Baseline: `claude/hud-gui-overhaul-dxp9e3` at `16a5adf` (the current state of the
codebase; `main` is strictly behind it). Measured, not guessed: `bun run
typecheck` clean, `bun run lint` 0 errors / 63 warnings, `bun run test` 25 files /
290 tests green, ~31.6k lines of TypeScript across `src`, `packages`, `scripts`
and `test`.

Every item carries two ratings. **perf** is influence on the running game
(frame time, GC, load time, bandwidth). **conformity** is influence on
cleanliness, separation of concerns, KISS, and the repo's own written rules in
`AGENTS.md`. The tier is whichever of the two is higher.

---

## Tier 1 — high influence

### 1.1 `public/` ships 84 MB, and most of it is never loaded
perf: **high** (deploy size, clone time, CDN egress) · conformity: **high**

| path | size | referenced from `src` |
| --- | --- | --- |
| `public/spaceship_-_cb1` | 33 MB | one ship preset (`registry.ts:184`) |
| `public/icaras` | 25 MB | only `icaras/textures/` |
| `public/textures/hangar` | 20 MB | hangar backdrops |
| `public/ships/*.fbx` | 6.1 MB | seven ship presets |

`public/icaras` holds `.rar`, `.zip`, `.blend`, `.fbx`, four screenshots, six
HTML mockups and an `.mtl/.obj` pair; none of it is fetched by the app. Every
file under `public/` is deployed and served verbatim by Vercel.

Fix: delete everything in `public/icaras` except `textures/`; move source
assets (`.blend`, `.fbx`, `.rar`, `.zip`) out of the repo or into git LFS;
convert `ships/*.fbx` to Draco-compressed `.glb` (smaller, no FBXLoader parse
on the main thread); re-encode `textures/hangar` to KTX2 or at least WebP with
a size budget. Add a CI step that fails when `public/` exceeds a byte budget.

### 1.2 `BattleSim` is a 1 228-line god object on the 60 Hz hot path
perf: **med** · conformity: **high**

`packages/battle/src/sim.ts` has 45 methods and owns spawning, zones, weapons,
lock-on, lag compensation, scoring, bots and respawn. It carries 6 of the 63
lint warnings (complexity 16–29). It runs 60 times a second on the server and
again inside client prediction, so anything hard to read here is a determinism
bug waiting to happen.

Fix: keep `BattleSim` as the orchestrator and lift pure subsystems out beside
`hitscan.ts` and `projectiles.ts`, which already show the pattern: `zones.ts`
(capture progress, ownership), `respawn.ts` (spawn choice, `respawnIndex`),
`lock-on.ts` (acquire/hold/break), `scoring.ts`. Each becomes a pure function
of `(state, input, tick)` and gets its own test file instead of sharing the
710-line `sim.test.ts`.

### 1.3 Scenes and the HUD write zustand directly, bypassing `publish.ts`
perf: **med** (React commits at frame rate) · conformity: **high**

`AGENTS.md` says sim outputs reach zustand only through
`src/engine/modules/publish.ts`, throttled to 15 Hz. In practice:

- `src/engine/scenes/battle.ts` calls `useBattleStore.getState()` at five
  sites and writes from inside frame callbacks.
- `src/engine/scenes/base.ts` writes `useCameraView` twice.
- `src/engine/hud/index.ts` reads five stores (`useStore`, `useTuningStore`,
  `useRaceStore`, `useShipStore`, `useBattleStore`) and writes tuning.

Fix: give battle the same shape race has — one `publishBattle` module that
owns every store write and runs on the publish cadence — and turn the HUD's
`read()` closures into one `HudSource` per mode built in the scene, so
`hud/index.ts` stops importing store modules at all.

### 1.4 `scenes/battle.ts` is an 837-line composition root with 38 imports
perf: **low** · conformity: **high**

It builds pools, tracks opponents, drives projectiles, publishes to the store,
handles respawn teleports and owns the post chain hookup. Composition roots
should wire; this one implements.

Fix: extract `battle/opponents.ts` (the `Opponent` map + remote hull
lifecycle), `battle/pools.ts` (beam/missile/blast pool construction and
stepping), and the store publisher from 1.3. Target: `mountBattle` under 250
lines that reads top to bottom.

### 1.5 Thirteen open PRs implement the same five ideas in parallel
perf: **high** (the fixes are real) · conformity: **high** (as a process)

PRs #17, #18, #19, #21 and #26 each add a renderer-quality controller under a
different path (`render/quality.ts` twice, `renderer-quality.ts`,
`render-quality.ts`, `quality/`), and all five conflict in `scenes/base.ts`.
#23 re-implements the HUD cadence that #20 and #26 also throttle. See the PR
triage section for what was merged and why the rest were not.

Fix for next time: one PR per concern, rebased onto the branch head before
review, with the umbrella PR (#17) split rather than merged.

### 1.6 HUD module is 4 977 lines with two 600-line files
perf: **med** (canvas redraws; #20 now gates them) · conformity: **high**

`hud/overlay.ts` (661), `hud/facets.ts` (564, 4 complexity warnings),
`hud/spatial-hud.ts` (498), `hud/panel.ts` (468). `drawRacePanels` and
`drawBattlePanels` are 90- and 110-line functions that switch on panel name.

Fix: a `Record<HudPanelKey, PanelPainter>` per mode so each panel is its own
small function and the dirty-key from #20 can live next to the painter it
protects. Rename `hud/overlay.ts` (visor overlays) or `dev/overlay.ts`
(physics debug) — two files with the same name in sibling directories.

---

## Tier 2 — medium influence

### 2.1 Race and battle duplicate their room, snapshot, input and CLI code
perf: none · conformity: **high**

| pair | identical lines |
| --- | --- |
| `packages/race/src/room.ts` ↔ `packages/battle/src/room.ts` | 76 |
| `packages/race/src/dev/replay-cli.ts` ↔ `packages/battle/src/dev/replay-cli.ts` | 46 of 81 |
| `src/engine/race/transport.ts` ↔ `src/engine/battle/transport.ts` | 53 |
| `packages/race/src/snapshot.ts` ↔ `packages/battle/src/snapshot.ts` | 10 |

The PONG clock handshake, match recording and snapshot loop are copy-pasted.
`packages/net` is mode-agnostic by design and already hosts the codec and
clock; a `net/room-clock.ts` (PONG handler as a pure function), a
`net/dev/replay-cli.ts` (arg parsing + double-run hash compare) and a shared
`engine/net/mode-transport.ts` base would remove most of it.

### 2.2 `mulberry32` is implemented three times
perf: none · conformity: **med**

`src/engine/battle/arena-visuals.ts:54`, `src/lib/ship/materials.ts:644`,
`packages/battle/src/sim.ts:112`. One copy in `packages/physics` (a leaf both
sides can import) with `fork(label)`, as `AGENTS.md` already describes.

### 2.3 Two import aliases for one directory
perf: none · conformity: **med**

35 files import through `@/`, 8 through `Δ`. Both resolve to `src/`. Two
spellings of the same path is entropy with no upside. Either finish the
mechanical pass to `Δ` in one commit and delete `@/*` from `tsconfig.json`, or
drop `Δ`. An eslint `no-restricted-imports` rule then keeps it that way.

### 2.4 Dead files and stale documents
perf: none · conformity: **med**

- `src/hooks/use-toast.ts` — zero importers.
- `PROMPT.md`, `.modified` — zero bytes, committed.
- `flats-hover.jpeg` — 72 KB screenshot at the repo root.
- `docs/blueprint.md` — describes "Galactic Racer", an asteroid game on React
  Three Fiber. Neither exists any more.
- `tsconfig.json` excludes `src/ai` and `src/components/ui`, which do not exist.
- `AGENTS.md` still points at `src/engine/clock.ts`,
  `src/engine/dev/scenario.ts`, `src/engine/physics/colliders.ts`,
  `src/engine/sim/thrusters.ts`, `src/engine/sim/lab/` and
  `test/vehicle-physics.mjs`; all moved into `packages/` or were renamed.
- `.agents/skills/debug-live/SKILL.md` and `.claude/skills/debug-live/SKILL.md`
  have already drifted by 83 lines. Keep one, symlink the other.

### 2.5 `src/lib/ship/materials.ts` is 781 lines of paired painters
perf: none · conformity: **med**

Eight `draw<X>Pattern` functions each have a `drawEmissive<X>Pattern` twin, then
`applyShipConfig` switches over names. A `PATTERNS: Record<PatternId, { base,
emissive }>` table collapses the dispatch and makes adding a livery a one-entry
change. Also carries 4 complexity warnings.

### 2.6 Lint debt is concentrated, not diffuse
perf: none · conformity: **med**

63 warnings: 23 `complexity`, 19 `max-statements`, 9 `no-nested-divs`, 4
`prefer-no-use-effect`, 3 `no-style-prop`. Eight files hold most of them:
`sim.ts` (6), `materials.ts`, `hud/facets.ts`, `hangar-controls.tsx`,
`map-editor.tsx`, `hangar/page.tsx` (4 each), `scenes/battle.ts` (3). Set
`--max-warnings 63` in CI today and ratchet it down; the React ones are
CSS-module fixes.

### 2.7 `src/lib/utils.ts` is a grab-bag that owns `vehicleConfig`
perf: none · conformity: **med**

Nine importers reach `vehicleConfig` through a file called `utils`, and
`src/engine/state.ts` exists mainly to re-export physics types plus that
config. Move `vehicleConfig` next to the tuning code in `src/lib/tuning.ts`
and import `ShipTuning` from `@crash-velocity/physics` directly.

### 2.8 `hangar-controls.tsx` hard-codes thirty random ranges
perf: none · conformity: **med**

444 lines of component plus 294 lines of CSS; the `randomize` handler lists
`0.2 + Math.random() * 0.75`-style ranges inline for fourteen fields. A
`RANDOM_RANGES` table in `src/lib/ship/` beside `SHIP_PRESETS` keeps the UI
declarative and lets the hangar scene and tests reuse it.

### 2.9 Unused and misplaced dependencies
perf: low · conformity: **med**

`zod` is in the root `package.json` but nothing under `src` imports it (the
packages that use it declare their own). `webgl-report.ts` imports `three` from
`src/components`, the one place `AGENTS.md` says three must not appear outside
`scene-canvas.tsx`; it belongs in `src/engine/dev`.

---

## Tier 3 — low influence, worth a sweep

- `packages/battle/src/bot.ts` (230 lines) and `bots.ts` (71) — two files one
  letter apart. Merge or rename to `bot-brain.ts` / `bot-roster.ts`.
- `Date.now()` inside `snapshot.ts` builders in both modes — inject the clock so
  snapshot tests do not depend on wall time.
- `scene-canvas.tsx` exports `AnyApp = App<any>` and `base.ts` has three
  `as any` casts at the bridge; type the mount contract once and delete the
  eslint-disable comments.
- `test/vehicle-physics.ts` is a bun script, not a vitest test; it belongs in
  `scripts/` with `crash-lab.ts`.
- `camera/rig.ts` defines its own `lerp`/`smoothstep`; `THREE.MathUtils` has
  both.
- `README.md` says "9 ships"; count the presets in `registry.ts` before the
  next release and let the README import the number or drop it.
- Allocation discipline is already good: scratch vectors are module-level in
  `rig.ts`, `visuals.ts`, `sim.ts`, and #22 removed the transports' per-frame
  arrays. Keep `docs/battle-allocation-profile.md` as the check.
- Add `max-lines: 500` to the eslint config so the next 800-line file is a
  conscious decision.

---

## Open PR triage

All thirteen feature PRs targeted `claude/hud-gui-overhaul-dxp9e3` from the same
base (`6e9c387`). Each was dry-run merged against the branch head and against
every other PR before deciding.

### Merged into `claude/hud-gui-overhaul-dxp9e3`

| PR | what | notes |
| --- | --- | --- |
| #26 | adaptive renderer quality controller | clean; chosen over #17/#18/#19/#21 as the most complete of the five (staged degrade/recover, p95/p99 sampling, HUD Hz, tests) |
| #22 | cached transport frame views, zero steady-state render allocations | clean; adds the allocation-profile doc |
| #25 | static arena instancing and merged geometry | conflicts were the hemisphere lights and fog that `13163f9` moved into `scenes/environment.ts`; kept the PR's `root` group + `finaliseStaticScene`, dropped the re-added lights |
| #20 | HUD dirty-tracking and quantised render keys | conflicts with the touch-rail commit; kept `forcedTouch` and `wantsTouchControls`, added `panelHz`, dropped four dead scratch vectors head had already deleted |
| #14 | scene lifecycle: pause when hidden, reduced motion | conflicts with #26 in `post.ts` (combined: `level > 0 && !reducedMotion()`) and `base.ts`; its `panel.ts` hunk decorated a noise pass #20 had removed, so it was dropped along with its import |

Result: typecheck clean, lint 0 errors, 28 files / 295 tests green.

### Left open, and why

| PR | reason |
| --- | --- |
| #17 | umbrella of #18 + lifecycle + transport tweaks; superseded by #26, #22, #14 |
| #18, #19, #21 | three more renderer-quality controllers; all conflict with #26 in `base.ts`. Close, or rebase the shadow-preset half of #21 onto #26's `QualitySettings.shadowSize` |
| #23 | render cadence + invalidation; overlaps #26's `hudHz` and #20's dirty keys, conflicts in `spatial-hud.ts` and `base.ts` |
| #24 | battle render-view culling; conflicts with #22 in `scenes/battle.ts`, and it reaches into `packages/physics` to add `COLLISION_GROUPS` on every collider — a physics change that should be its own PR with a determinism run |
| #15, #27 | benchmark capture and interpolation diagnostics; dev-only, conflict in `dev/harness.ts` with the branch head. Rebase and merge separately |
| #12 | the branch itself → `main`; out of scope here |
| #3 | dependabot `@babel/runtime` → `main`; unrelated |

## Suggested order

1. 1.1 asset purge — one afternoon, removes 60+ MB from every clone and deploy.
2. 2.4 dead files and doc drift — one commit, no risk.
3. 1.3 + 1.4 battle store publisher and composition-root split — unlocks 1.6.
4. 1.2 `BattleSim` extraction, one subsystem per PR, determinism replay after each.
5. 2.1 shared room/CLI helpers in `packages/net`.
6. 2.3 alias unification and the lint ratchet, then rebase #15, #27 and the shadow half of #21.
