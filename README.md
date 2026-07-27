# Crash Velocity

A Burnout-inspired 3D arcade racer built with **Next.js 16**, **vanilla three.js** (composed with
[`threejs-scene`](https://www.npmjs.com/package/threejs-scene)) and **Rapier** physics. Pick from
**9 ships** in the hangar, then race one of four tracks.

React renders the DOM — menus, HUD, hangar panel — and nothing else. Everything inside the canvas
is plain three.js driven by the engine in `src/engine/`; `src/components/scene-canvas.tsx` is the
only file where the two meet. See [Architecture](#architecture).

## Run locally

```bash
npm install
npm run dev      # http://localhost:9002
```

```bash
npm test          # level geometry, nozzle inference, tuning source output
npm run test:physics   # headless Rapier harness — the ship must stay upright
```

All dependencies come from the public npm registry; no token or private scope is needed.

## Controls

| Input | Action |
| --- | --- |
| `W` / `↑` | Thrust |
| `←` `→` / `A` `D` | Steer (and steer the nose mid-jump — *aftertouch*) |
| `Shift` (hold) | Boost — extra thrust + higher top speed while the reserve lasts |
| `R` | Respawn at the last checkpoint |

## Race rules

- A **3-2-1 countdown** gates the throttle; you launch on **GO!**.
- **Loop tracks** (Neon Canyon, Orbital Ring) are **3 laps** — cross the checkpoints in order;
  the start/finish line closes each lap. **Origin Circuit** is a single **sprint** to the finish.
- Falling off, flipping over, or pressing `R` respawns you at the last cleared checkpoint.
- Hard impacts shake the camera and flash the screen.
- Lap / total / best times show in the HUD; the finish screen has a **Race Again** button.

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
  levels/              the four tracks, as LevelSpec data
  physics/             Rapier world + collider helpers
  camera/rig.ts        chase camera
  fx/afterburner.ts    engine plume
  clock.ts             fixed-step clock that exposes its residual (see below)
  bridge.ts            zustand -> app state, one direction only
src/components/scene-canvas.tsx   the ONLY React<->three boundary
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

## Physics & camera

A Rapier **raycast vehicle controller repurposed as a hovercraft** — suspension rest length is the
hover height. Tracks collide via **cuboid box strips**, not trimeshes: the vehicle controller's
wheel raycasts do not register against a trimesh and the ship falls through.

The `setAngvel` block that aligns the ship to the surface normal is **load-bearing, not cosmetic**.
With it removed, thrust torques the ship onto its back within a second. `test/vehicle-physics.mjs`
asserts exactly that (`min up-dot after settle: 1.000`).

Camera damping is framerate-independent (`1 - exp(-k·dt)`), and the rig follows a **yaw-only**
quaternion so it does not roll with the banked hull. See `src/engine/camera/rig.ts`.

### Live tuning

The race HUD carries a **tuning panel** (top right, collapsed by default) over the seven physics
knobs that used to live in Leva. Unlike Leva it persists to `localStorage`, so a tuning session
survives a reload, and **copy as TS** emits just the values that moved as a block you paste into
`vehicleConfig` in `src/lib/utils.ts`.

## Deploying

Nothing special — all dependencies are public. `npm ci && npm run build` on any host.

> If an install ever starts failing with `401 Unauthorized` from `npm.pkg.github.com`, the cause is
> a resurrected `package-lock.json` carrying old `@tuomashatakka`-scoped entries. This project uses
> `bun.lock`; delete the npm lockfile rather than re-adding a `NODE_AUTH_TOKEN`.
