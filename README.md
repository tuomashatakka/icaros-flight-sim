# Crash Velocity

A Burnout-inspired 3D arcade racer built with **Next.js 16**, **vanilla three.js** (composed with
[`threejs-scene`](https://www.npmjs.com/package/threejs-scene)) and **Rapier** physics. Pick from
**9 ships** in the hangar, then race one of four tracks — from a third-person chase camera or from
inside the cockpit.

React renders the DOM — menus, hangar panel, and the small amount of race chrome that is not part
of the flight. Everything else lives inside the canvas as plain three.js driven by the engine in
`src/engine/`; `src/components/scene-canvas.tsx` is the only file where the two meet. See
[Architecture](#architecture).

## Run locally

```bash
bun install                 # the project uses bun.lock; npm install works too
bun run dev                 # http://localhost:9002
bunx playwright install chromium   # once, for the dev CLI below
```

```bash
bun run test           # level geometry, nozzle inference, tuning source output
bun run test:physics   # headless Rapier harness — the ship must stay upright
bun run typecheck
bun run lint
```

All dependencies come from the public npm registry; no token or private scope is needed.

## Controls

| Input | Action |
| --- | --- |
| `W` / `↑` | Thrust |
| `S` / `↓` | Brake |
| `←` `→` / `A` `D` | Steer (and steer the nose mid-jump — *aftertouch*) |
| `Shift` (hold) | Boost — extra thrust + higher top speed while the reserve lasts |
| `C` | Toggle chase ⇄ cockpit view |
| `R` | Respawn at the last checkpoint |
| Drag on the canvas | Steer, absolute from the press point, recentring on release |
| Move the mouse (no button) | Look around — a slight camera pan, easing back to centre |

Steering and panning deliberately use different gestures. Drag was already steering, so panning
rides plain hover instead: the two can never contend, and looking around cannot fight a turn
mid-corner.

## Race rules

- A **3-2-1 countdown** gates the throttle; you launch on **GO!**.
- **Loop tracks** (Neon Canyon, Orbital Ring) are **3 laps** — cross the checkpoints in order;
  the start/finish line closes each lap. **Origin Circuit** is a single **sprint** to the finish.
- Falling off, flipping over, or pressing `R` respawns you at the last cleared checkpoint.
- Hard impacts shake the camera and flash the screen. The shake is much gentler in the cockpit —
  a jolt that reads well from outside is nauseating from a seat.
- Lap / total / best times show in the holographic HUD; the finish screen has a **Race Again**
  button.

## Tracks

- **The Flats** — flat proving ground for learning the handling.
- **Origin Circuit** — branching procedural sprint with a shortcut jump.
- **Neon Canyon** — banked, winding ravine loop.
- **Orbital Ring** — banked figure-eight station suspended in the starfield.

## Ships

Ships are registered in one place — `src/lib/ship/registry.ts` (`SHIP_PRESETS`). The store,
hangar selection grid, and runtime loader all derive from it, so adding a ship is a single entry.

- **CB1** — GLTF model (`public/spaceship_-_cb1/`), fully recolourable in the hangar.
- **Icaras** — procedurally rebuilt mesh with baked PBR livery (`public/icaras/`).
- **WipEout fleet** — AG-Systems, Assegai, Auricom, EG-X, Feisar, Harimau, Qirex — FBX hulls
  (`public/ships/<id>/`) re-skinned from per-ship livery (CC-BY-4.0, Nobby76).

### How the hangar sliders apply

Ships carrying a baked livery (Icaras + the WipEout fleet, tagged `userData.pbrTextured`) are
**modulated, never repainted**: body colour, metalness, roughness and glow intensity all apply on
top of the atlas, while `texturePreset` / `textureRepeat` stay inert and are disabled in the panel.
CB1 is the only ship whose maps are generated from `texturePreset`, so it alone honours all eight
fields. The emissive controls drive the `Glow` bucket only — a full-body emissive wash would flood
the livery out of existence. See `applyShipConfig` in `src/lib/ship/materials.ts`.

### Afterburner

Every hull carries an engine plume (`src/engine/fx/afterburner.ts`): two additive quads crossed
about the thrust axis, a nozzle flare and a short-range point light, per engine. In the race it
tracks the throttle — idle floor, thrust, boost — and in the hangar it follows the `engines`
toggle. `burnColor` / `burnIntensity` / `burnLength` / `nozzleSpread` are per-ship and persisted.

Nozzle positions are **inferred**, since these are scanned meshes with no engine markers. The
loader looks first for vertices belonging to a material named `Glow` — the WipEout scans annotate
their exhausts — and takes the centroid either side of the hull axis. Hulls without that material
(CB1, the generated Icaras) fall back to the centroid of all tail-slab vertices. Two geometric
reads that look obvious both fail here and are worth not re-inventing: the tail slab's *width* is
the wingspan (a delta's trailing edge is as far back as its engines), and its *thickness* peaks on
the fuselage rather than the pods. `nozzleSpread` scales whatever was detected, so a miss is one
slider away from fixed.

### Working on the FBX hulls

Two things about these scans are easy to get wrong (see `src/lib/ship/fbx-ship.ts`):

- Each hull is **one mesh carrying a 4-material array** (`Body`/`Cockpit`/`Glass`/`Glow`) plus 5–29
  geometry groups, and **the array order differs per ship** — Feisar is `[Body, Glow, Cockpit,
  Glass]`, AG-Systems `[Glow, Body, …]`. Remap slot-by-slot; collapsing to a single material paints
  the whole ship with whatever sat at index 0.
- Their textures must load with three's **default `flipY`**. `flipY = false` is the glTF convention
  (correct in `icaras-generated.ts`, whose mesh inherits glTF UVs) and mirrors these atlases
  vertically. UVs also run outside `[0,1]`, so `RepeatWrapping` is required or the border smears.

The per-ship `* glass A.jpg` / `Lights_GLOW A.jpg` alpha masks were never extracted, so glass and
glow alpha is derived from each atlas's **luminance** at load — not via `alphaMap` directly, which
samples only the green channel and would erase the red canopies (Qirex, AG-Systems, EG-X).

## Architecture

```
src/engine/            vanilla three.js — no React imports anywhere below this line
  scenes/              composition roots: race.ts, hangar.ts
  modules/             AppModules: vehicle, physics-step, race, ship-visual, sun, publish
  hud/                 the in-scene holographic HUD (see below)
  levels/              the four tracks, as LevelSpec data
  physics/             Rapier world + collider helpers
  camera/rig.ts        chase + cockpit camera, as two blended stations
  fx/afterburner.ts    engine plume
  clock.ts             fixed-step clock that exposes its residual (see below)
  bridge.ts            zustand -> app state, one direction only
  dev/                 dev-only debug harness; dropped from production builds
src/components/hud/    the DOM half of the race UI
src/components/scene-canvas.tsx   the ONLY React<->three boundary
public/scenarios/      scripted input timelines for the dev CLI
scripts/dev-cli.mjs    drive the running game from a shell (see below)
```

State flows one way: `zustand -> bridge -> app state -> module.update() -> scene`. Modules read
state and never write it. Engine *outputs* (speed, boost, lap times) travel back out through the
publish module on a throttled schedule, and the two sets of fields are disjoint, so there is no
feedback loop.

**Simulation runs at a fixed 60 Hz and rendering is interpolated.** `src/engine/clock.ts` mirrors
the library's fixed-step arithmetic but also exposes the leftover accumulator as `alpha()`; the
root `render` hook samples each body's pose between its previous and current transform at that
alpha. Without this the ship stair-steps on a 120 Hz display — sampling the raw
`body.translation()` shows the same transform for two frames running.

### Styling

Plain CSS. No utility framework, no component library, no preprocessor.

- `src/app/globals.css` — design tokens and the reset. Colours are declared twice: a bare HSL
  triple (`--accent-hsl`) and a finished colour (`--accent`). The triple exists so a rule can
  compose an alpha variant, `hsl(var(--accent-hsl) / 0.3)`.
- The `--holo-*` tokens are the HUD palette, and they are kept **in sync by hand** with `HOLO` in
  `src/engine/hud/materials.ts`. Nothing in the build can share a constant between a GLSL uniform
  and a stylesheet, and the projection and the DOM chrome that frames it have to read as one system.
- `*.module.css` next to each component — scoped class names, no global collisions. Shared chrome
  within a file uses `composes:`.
- Form controls (range, color, text, select) are styled once in `globals.css`, since nearly every
  panel in the app is a stack of them.

Anything genuinely per-instance — a level's card gradient, a slider's fill width — is passed as a
CSS custom property in a `style` prop and consumed by one rule, rather than generating a class per
value.

## Physics & camera

A Rapier **raycast vehicle controller repurposed as a hovercraft** — suspension rest length is the
hover height. Tracks collide via **cuboid box strips**, not trimeshes: the vehicle controller's
wheel raycasts do not register against a trimesh and the ship falls through.

The `setAngvel` block that aligns the ship to the surface normal is **load-bearing, not cosmetic**.
With it removed, thrust torques the ship onto its back within a second. `test/vehicle-physics.mjs`
asserts exactly that (`min up-dot after settle: 1.000`).

### Two stations, one rig

`src/engine/camera/rig.ts` holds a single `PerspectiveCamera` and two **stations** — `CHASE` and
`COCKPIT` — that it lerps between over ~0.55 s. There is only one camera on purpose: `createApp`
binds the camera it is given to its resize observer at construction, so a second camera swapped in
later would never have its aspect corrected.

Three things vary across the blend, and each exists for a reason:

- **The quaternion fed to the rig.** Chase gets a **yaw-only** quaternion so the horizon stays
  level however the hull banks — rolling a third-person camera with the ship is nauseating. Cockpit
  gets the full hull orientation, because a canopy that does not bank is not a canopy. The
  transition slerps between the two.
- **`camera.up`.** `FollowCamera.update` ends in `camera.lookAt`, which honours `camera.up`, so
  blending up from world-up to the hull's own up *is* the cockpit roll. No extra machinery.
- **`positionDamping`.** Chase is damped, and the resulting steady-state lag is what reads as
  weight. Cockpit is rigid (`0`): exponential smoothing against a moving target lags by roughly
  speed × half-life, so a damped seat would trail out through the back of the hull at speed.

Chase's aim is expressed as a local `lookOffset: [0, 0.8, 0]` rather than the equivalent
`lookAhead: 0.8`. Under a yaw-only quaternion the two are the same point (Y is invariant under a
rotation about Y), but saying it the local way puts both stations in the same aiming mode, which is
what makes the transition a plain lerp instead of a discontinuous mode flip.

The look-around pan is **rotation only**, applied after the rig has solved. A positional pan would
be read back by `camera.position.lerp` on the next frame and walk the whole rig off its offset —
the same feedback the impact shake already works around by subtracting itself before each update.

At full cockpit the exterior hull is hidden, since it encloses the camera and all you would
otherwise see is the inside of its back faces.

## The holographic HUD

Speed, boost, lap, time, the artificial horizon and the next-gate marker are **in-scene geometry**,
not DOM — `src/engine/hud/`. Two sets cross-fade with the camera: a full canopy parented to
`shipRoot` (so it inherits the interpolated pose and banks with the hull), and a pared-back
camera-locked strip for chase view.

- Every element shares one `ShaderMaterial` (`materials.ts`) — additive, `depthWrite: false`,
  `depthTest: false`, and **`toneMapped: false`**. That last flag is the one that matters: the
  composer tone-maps once at `OutputPass`, and letting the HUD through that curve would drag its
  colour back under the per-level bloom threshold (0.85–0.92), which is exactly what it needs to
  cross in order to glow. No dedicated bloom pass is needed.
- Gauges fill by moving a single `uFill` uniform. Arc geometry is authored with `uv.x` running
  along the *sweep*, so one shader serves both arcs and bars without a branch.
- The cockpit panel is authored in **screen axes** and turned to face back down the nose
  (`rotation.y = π`). The camera looks along the ship's **+Z**, which makes its right axis the
  ship's **−X**; without that rotation the whole panel is mirrored *and* every text plane presents
  its back face, which silently culls the readouts, since `MeshBasicMaterial` is `FrontSide` by
  default.
- The horizon ladder counter-rotates against the hull, because it represents the world while
  everything around it belongs to the ship.
- Text is canvas-textured (there is no SDF font in the project) and **only redraws when the string
  changes**. That guard is what lets the HUD run at frame rate; a texture upload per readout per
  frame would dwarf everything else it does.

State is read **imperatively** — `telemetry` directly, and `useRaceStore.getState()` per frame.
Subscribing would put a React commit in the render path, which is the exact thing the throttling in
the publish module exists to avoid.

### Race clocks

`raceTimers` in `src/hooks/use-race-store.ts` is a plain mutable object, for the same reason
`src/engine/telemetry.ts` is: the clocks advance every 60 Hz sim step, and writing them into zustand
at that rate forced 60 React commits a second — which quietly defeated the 15 Hz throttling
elsewhere, since the race bar re-rendered on every step anyway. The HUD reads the live object and
stays exact to the millisecond; the store mirrors it on a throttle for the finish card. Lap times
are taken from the live clock at the instant of the crossing, never from the throttled copy.

### Live tuning

The race screen carries a **tuning panel** (top right, collapsed by default) over the seven physics
knobs that used to live in Leva. Unlike Leva it persists to `localStorage`, so a tuning session
survives a reload, and **copy as TS** emits just the values that moved as a block you paste into
`vehicleConfig` in `src/lib/utils.ts`.

## Debugging & dev tooling

The race scene exposes a debug harness at `window.__dev` in development, and
`scripts/dev-cli.mjs` drives it from a shell. It reuses a dev server already
listening on :9002 and starts one otherwise.

```bash
bun run dev:probe --level flats             # full state snapshot as JSON
bun run dev:scenario straight-line          # deterministic scripted run
bun run dev:scenario hard-corner --json --out /tmp/trace.json
bun run dev:shot /tmp/a.png --step 300 --overlay colliders,wheels
bun run dev:console --seconds 5             # errors, frame times, WebGL state
bun run dev:eval -e '__dev.probe().ship.up'
```

### Scenarios

A scenario is a JSON input timeline in `public/scenarios/` — "throttle at 0 s,
hard left at 5 s, straighten at 7 s". The runner disables rendering and pumps
the sim with `app.tick()`, so **12 sim seconds complete in about 30 ms**, and
because the simulation is deterministic two runs produce byte-identical traces.
A handling change becomes a diff rather than an opinion.

```jsonc
{
  "name": "hard-corner",
  "level": "neon-canyon",
  "duration": 16,          // sim seconds
  "sampleEvery": 0.5,      // sim seconds per trace row
  "start": { "position": [0, 2, 0], "yaw": 0 },   // optional
  "tuning": { "thrust": 1200 },                    // optional
  "timeline": [
    { "at": 0, "input": { "throttle": true } },
    { "at": 5, "input": { "steer": -1 } },
    { "at": 7, "input": { "steer": 0, "boost": true } }
  ]
}
```

The default output is a summary. `minUp` is the flip detector (1 = level,
0 = on its side, -1 = inverted); `flipped` and `fellThrough` are deliberately
separate, because driving off a canyon edge perfectly level and losing attitude
control are different bugs with different fixes. `airborneRatio` being high is
normal — this ship is meant to leave the ground.

Reproducibility is maintained rather than inherited: the runner resets the body
pose, the race store, telemetry and the publish accumulator, then runs 60 settle
ticks to wash out rapier's warm-start impulses, before the timeline starts. If
you add simulation state that persists across ticks, reset it there too or
scenarios touching it quietly stop being reproducible.

### Debug overlays

`--overlay` (or `?overlay=` on the URL) draws rapier collider wireframes,
suspension rays with wheel contact normals, contact manifolds, the ship's path,
and a helper on the sun's shadow camera — the last being the direct check for
"has the ship driven out of the shadow frustum again".

### URL overrides

`?seed=` `?paused=1` `?overlay=colliders,wheels` `?nohud=1` `?tuning=<base64>`
`?scenario=<name>` — so any bug report can be a link that reproduces it exactly.

None of this exists in production: it sits behind `NODE_ENV !== 'production'`
and loads through a dynamic import, so the whole chunk is dropped from the
build.

## Deploying

Nothing special — all dependencies are public. `bun install && bun run build` on any host.

> If an install ever starts failing with `401 Unauthorized` from `npm.pkg.github.com`, the cause is
> a resurrected `package-lock.json` carrying old `@tuomashatakka`-scoped entries. This project uses
> `bun.lock`; delete the npm lockfile rather than re-adding a `NODE_AUTH_TOKEN`.
