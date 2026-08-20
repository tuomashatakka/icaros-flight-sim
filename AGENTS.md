# AGENTS.md

Guidance for AI coding agents working in this repository. This is the canonical
agent document; `CLAUDE.md` points here rather than duplicating it.

**Crash Velocity** — a hovercraft racing game. Next.js App Router shell, vanilla
three.js scene, Rapier physics. No React Three Fiber: it was removed
deliberately and should not come back.

## Commands

Package manager is **bun**. Do not create a `package-lock.json` — a resurrected
one has broken installs before, with `401 Unauthorized` from
`npm.pkg.github.com`. Delete it rather than adding a `NODE_AUTH_TOKEN`.

```bash
bun run dev          # next dev on :9002
bun run typecheck    # tsc --noEmit
bun run lint         # eslint src
bun run test         # vitest, headless node only
bun run test:physics # standalone Rapier vehicle harness
bun run build
```

## Debugging the live app

**Use the CLI, not browser screenshots.** `scripts/dev-cli.mjs` boots the game,
talks to the in-page `window.__dev` harness, and prints compact JSON. It reuses
a dev server already listening on :9002 and starts one otherwise.

```bash
bun run dev:probe --level flats             # full state snapshot, one JSON object
bun run dev:scenario straight-line          # deterministic scripted run + summary
bun run dev:scenario hard-corner --json --out /tmp/t.json
bun run dev:scenario turn-response           # isolated steering authority
bun run dev:scenario strafe-response         # isolated lateral authority
bun run dev:shot /tmp/a.png --step 300 --overlay colliders,wheels
bun run dev:shot /tmp/b.png --level battle --at 0,3,-190   # frame a spot directly
bun run dev:console --seconds 5             # errors, frame times, WebGL state
bun run dev:eval -e '__dev.probe().ship.up'
bun run dev:shot /tmp/t.png --level battle --query touch=1,post=low
```

`--level battle` targets `/battle` rather than `/levels/<name>`. `--at x,y,z[,yaw]`
teleports before framing, which on a 600-unit deck beats driving there.

Requires `bunx playwright install chromium` once. In a sandbox that already has
a chromium of a different build, set `CHROMIUM_PATH=/path/to/chrome` instead of
re-downloading one. First run against a cold server takes ~30 s; against a warm
one, ~6 s.

The battle scene also installs `window.__devBattle` in dev — `probe()`,
`place(id, x, y, z)` and `face(x, z)` — because the generic harness speaks
vehicle-and-track and cannot place an enemy or read a lock meter.

A **scenario** is a JSON input timeline in `public/scenarios/`. It runs with
rendering disabled, so ~12 sim seconds complete in ~20–40 ms — and because the
sim is deterministic, two runs produce byte-identical traces. That makes
handling regressions diffable instead of anecdotal.

`summary.flipped` (orientation failure) and `summary.fellThrough` (went below
the track) are separate on purpose — different causes, different fixes. A run
with `fellThrough: true` and `minUp` near 1 drove off an edge; it did not lose
control. Thresholds are constants at the top of `src/engine/dev/scenario.ts`.

URL overrides in dev: `?seed=`, `?paused=1`, `?overlay=colliders,wheels`,
`?nohud=1`, `?tuning=<base64>`, `?scenario=<name>`. Any reproduction can be
handed over as a link rather than a procedure.

Full reference, including the whole `window.__dev` surface:
`.claude/skills/debug-live/SKILL.md`.

### Determinism is maintained, not inherited

Reproducibility is **not** free. A scenario inherits state from however long the
page ran before it, so `runScenario` explicitly resets, before the timeline:

- body pose → `start` or the race spawn, zero velocity
- 60 settle ticks with neutral input, to wash out rapier's warm-start impulses
  and the vehicle controller's per-wheel suspension state
- the race store (`resetRace()`) — lap, next checkpoint, respawn target
- telemetry — `boostMeter` especially, which drains and never refills
- the publish module's zone-escalation accumulator
- `controls.pitch` and `controls.strafe`, the held aim and lateral axes

Everything is restored afterwards, so running a scenario mid-race is safe.

**If you add sim state that persists across ticks, reset it there too.**
Otherwise scenarios touching it stop being reproducible, silently. Each of the
five items above was found by diffing two runs of the same script — not by
reading the code.

## Architecture rules

These are the constraints that are expensive to rediscover.

**Data flows one way.** zustand → `app.setState` (via `src/engine/bridge.ts`) →
modules read state. Modules never write state. Sim *outputs* go the other way
through `src/engine/modules/publish.ts`, throttled to 15 Hz — writing telemetry
into zustand at 60 Hz costs 60 React commits a second.

**Controls.** `Q/E` and the arrows turn, `A/D` strafe, `R/F` walk the vertical
aim, `Backspace` respawns. `R` used to be respawn and `F` used to be battle's
fire-primary; both moved. `controls.pitch` is a raw held axis and each mode owns
its own policy — race springs it back to level in the render phase, battle
integrates it into `BattlePlayer.aimAngle` inside the sim so the trim holds, is
deterministic, and survives the netcode. In battle it feeds `BattleSim.aimOf`,
which is what lock acquisition and both weapons aim along; `forwardOf` stays the
true hull facing and is what the muzzle position uses.

**Handling authority lives in shared physics.** Race and battle both call
`stepHovercraft`, so turn/strafe feel belongs in `vehicleConfig` and
`vehicle-step.ts`, never in one input path. The calmer baseline is 1.45 rad/s
ground yaw with a 0.5 high-speed scale, plus a 0.14 strafe-speed scale and 8.0
response. Verify changes with the `turn-response` and `strafe-response`
scenarios; do not tune keyboard, pointer, and touch independently.

**Touch is a third path onto the same `Controls` object.** The standalone spatial
HUD (`src/engine/hud/`) draws twin sticks and action buttons into its screen
plane, then writes through native pointer listeners — never React state, because
a `useState` per pointermove re-renders at thumb rate. Weapon triggers live on
`Controls` (`fire`, `fireSecondary`) rather than in `battle.ts` so keys, mouse,
and touch agree. `?touch=1` forces the canvas controls on in dev, and `dev-cli
--query touch=1` reaches them.

**Post-processing extends through `BaseSceneConfig.postEffects`.** Battle's chain
lives in `src/engine/battle/post.ts`. Two traps it documents: nothing may sample
the composer's shared depth texture (it is attached to both render targets, so
binding it while writing renders the frame black with no error — this is why
there is no motion blur), and `createGodRaysPass` without a dedicated occlusion
buffer treats every emissive in the arena as a light source.

**Additive geometry the camera can enter will wash the frame.** Commit `07cff7e`
found it with the zone beacons; a horizon-glow cylinder around the deck hit it
again at arena scale. If it surrounds the play area it belongs in the sky shader,
not in the scene graph.

**Module order in `race.ts` is load-bearing.** `postProcessing` must be last:
the last-mounted module with a render hook wins, and it owns the composer. The
rapier world and the clock are built *before* `createApp` and injected, because
`createApp` builds and updates modules from one ordered array, so "built first,
stepped last" is unsatisfiable as a module.

**Fixed timestep, manual interpolation.** `STEP = 1/60` in `src/engine/clock.ts`
is the clock step, `world.timestep`, and the vehicle `dt` simultaneously.
Rendering samples `BodyInterpolator.sample(clock.alpha(), …)` — never the raw
body, or poses stair-step above 60 Hz. After any `setTranslation`/`setRotation`,
call `interpolator.teleport()` or the ship visibly smears to the new pose.

**Colliders must be cuboids.** Track collision is box strips
(`src/engine/physics/colliders.ts`), not a trimesh — the ship falls through a
trimesh at speed.

**The upright control is not cosmetic.** The surface-alignment `setAngvel` in
`src/engine/modules/vehicle.ts` is what keeps thrust from torquing the ship onto
its back. Removing it looks harmless and is not.

**Yaw sign lives in the vehicle.** `steer` is negated exactly once, in
`vehicle.ts`. +Y rotation is a LEFT turn.

**Shadows need both halves.** The sun module follows the ship
(`src/engine/modules/sun.ts`) because a fixed shadow frustum loses it once the
ship drives out; and `castShadow` has to be set on every path that builds ship
geometry, not just the glTF one.

**Determinism is a feature.** Seeded rng with `fork(label)` per subsystem; no
`Math.random` anywhere inside the tick. Keep it that way — the scenario runner
depends on it.

**Styling is plain CSS.** No utility framework, no component library, no
preprocessor. Tailwind was removed on purpose.

## Layout

```
src/app/          Next routes. /levels/[level] and /hangar mount scenes.
src/components/   React. scene-canvas.tsx is the ONLY React↔three boundary.
src/engine/       The game. Vanilla three + threejs-scene, no React.
  scenes/         Composition roots (mountRace, mountHangar).
  modules/        AppModules: vehicle, race, publish, sun, ship-visual, physics-step.
  dev/            Dev-only harness. Excluded from production builds.
  hud/            Continuous visor GUI: live facets, overlays, hit testing, touch.
  levels/         The four tracks, as LevelSpec data.
  physics/        Rapier world + collider helpers.
src/hooks/        zustand stores.
public/scenarios/ Scenario scripts for the CLI and ?scenario=.
scripts/          dev-cli.mjs.
```

## Conventions

- No semicolons; single quotes; aligned object values. `eslint --fix` settles
  most of it — run it rather than hand-formatting.
- Comments explain *why*, not *what*. The existing ones are the house style:
  they record the constraint or the bug that forced the code to be that shape.
- Dev-only code lives behind `process.env.NODE_ENV !== 'production'` and is
  reached via dynamic `import()`, so it is eliminated from production bundles.
  Verify with `grep -r "__dev" .next/static` after a build — it must be empty.
