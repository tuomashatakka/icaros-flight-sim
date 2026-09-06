# Crash Velocity

A Burnout-inspired 3D arcade racer built with **Next.js 16**, **vanilla three.js** (composed with
[`threejs-scene`](https://www.npmjs.com/package/threejs-scene)) and **Rapier** physics. Pick from
**9 ships** in the hangar, then race one of four tracks — from a third-person chase camera or from
inside the cockpit.

React renders menus and the hangar panel. Race and battle render one interactive canvas each; every
in-session readout, control, modal, toast, and tuning surface belongs to the canvas-owned HUD.
Everything inside the canvas is plain three.js driven by `packages/engine/`, and
`packages/ui/src/scene-canvas.tsx` is the only file where React and three.js meet. See
[Architecture](#architecture).

## Run locally

```bash
bun install                 # the project uses bun.lock; npm install works too
bun run dev                 # http://localhost:9002
bunx playwright install chromium   # once, for the dev CLI below
```

```bash
bun run aliases:check  # every package tsconfig still matches scripts/aliases.mjs
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
| `←` `→` / `Q` `E` | Turn (and steer the nose mid-jump — *aftertouch*) |
| `A` `D` | Strafe left / right |
| `R` `F` | Aim or look up / down |
| `Shift` (hold) | Boost — extra thrust + higher top speed while the reserve lasts |
| `C` | Toggle chase ⇄ cockpit view |
| `Backspace` | Respawn at the last checkpoint |
| `Space` / `X` | Battle primary / secondary weapon |
| Drag on the canvas | Steer, absolute from the press point, recentring on release |
| Move the mouse (no button) | Look around — a slight camera pan, easing back to centre |

Steering and panning deliberately use different gestures. Drag was already steering, so panning
rides plain hover instead: the two can never contend, and looking around cannot fight a turn
mid-corner.

## Race rules

- A **3-2-1 countdown** gates the throttle; you launch on **GO!**.
- **Loop tracks** (Neon Canyon, Orbital Ring) are **3 laps** — cross the checkpoints in order;
  the start/finish line closes each lap. **Origin Circuit** is a single **sprint** to the finish.
- Falling off, flipping over, or pressing `Backspace` respawns you at the last cleared checkpoint.
- Hard impacts shake the camera and flash the screen. The shake is much gentler in the cockpit —
  a jolt that reads well from outside is nauseating from a seat.
- Lap / total / best times show in the holographic HUD; the finish screen has a **Race Again**
  button.

## Tracks

- **The Flats** — flat proving ground for learning the handling.
- **Origin Circuit** — branching procedural sprint with a shortcut jump.
- **Neon Canyon** — banked, winding ravine loop.
- **Orbital Ring** — banked figure-eight station suspended in the starfield.

## The map forge

`/editor` authors real levels, not diagrams. The document is a small JSON model
(`packages/ui/src/editor/document.ts`) in world metres; `compile.ts` turns it into an
actual `TrackSpec` or `BattleArena` by calling the same `buildTrack`,
`ribbonBoxColliders` and `plateauColliders` the shipped levels call, so the plan view
outlines the deck a room would simulate rather than a bezier that resembles it.

- **Circuits** — a Catmull-Rom through draggable control points with per-node width,
  elevation and bank; the compiler emits the ribbon, its box colliders, the gate
  waypoints, fog and bloom.
- **Arenas** — plateaus with per-face ramps, capture zones that snap to the deck they
  land on, per-team spawns and bases; the compiler emits the floor slab, the perimeter
  wall and one collider set per mesa.
- **Validation** names the failure modes the shipped levels hit: a start line that is
  already banking, a spawn buried in a mesa, a fog far plane shorter than the deck
  diagonal.

Every edit is an action through a pure reducer with undo/redo, and the four modules
with a decision in them are tested without a DOM (`packages/ui/test/map-editor.test.ts`).
Export gives you the authored source or the compiled runtime spec.

## Ships

Ships are registered in one place — `packages/core/src/ship/registry.ts` (`SHIP_PRESETS`). The
store, hangar selection grid, and runtime loader all derive from it, so adding a ship is a single
entry.

- **CB1** — GLTF model (`public/spaceship_-_cb1/`), fully recolourable in the hangar.
- **Icaras** — procedurally rebuilt mesh with baked PBR livery (`public/icaras/`).
- **WipEout fleet** — AG-Systems, Assegai, Auricom, EG-X, Feisar, Harimau, Qirex — FBX hulls
  (`public/ships/<id>/`) re-skinned from per-ship livery (CC-BY-4.0, Nobby76).

### Parametric hulls

Every ship's geometry is **extracted at load time and then reshaped by fifteen
parameters**. There is no per-ship table of landmarks:
`packages/engine/src/ship/hull-profile.ts` walks the vertex cloud of whatever the
loader produced — glTF scene, FBX clone or rebuilt part table — and measures the
half-beam (an |x| quantile, so one antenna cannot set the beam for the ship), the
wing threshold, the canopy floor, the widest station and the engine slab, in a
frame where the nose already points +z.

`hull-deform.ts` then moves the cloud against those landmarks, in the order a hull
is built up:

| group | parameters |
| --- | --- |
| Proportions | beam, profile, length |
| Planform | nose sharpness, tail taper, wing span, wing sweep, wing dihedral, chine flare |
| Section | canopy rise, keel depth, engine girth, engine overhang, spine arch, hull twist |

The fields live in `packages/core/src/ship/hull-shape.ts` (`HullShape`), so they are
persisted, randomised and rendered as sliders from one table — the hangar's hull
panel *is* `HULL_SLIDERS`. Two properties make it safe: the deformer always reads an
untouched per-mesh snapshot, so sliders never compound and the order you touch them
in cannot matter; and at factory values it restores that snapshot verbatim, authored
normals included. Engine nozzles and gun hardpoints are re-derived from the new
silhouette, so they follow the shape rather than staying pinned to the old one.

### How the hangar sliders apply

Ships carrying a baked livery (Icaras + the WipEout fleet, tagged `userData.pbrTextured`) are
**modulated, never repainted**: body colour, metalness, roughness and glow intensity all apply on
top of the atlas, while `texturePreset` / `textureRepeat` stay inert and are disabled in the panel.
CB1 is the only ship whose maps are generated from `texturePreset`, so it alone honours all eight
fields. The emissive controls drive the `Glow` bucket only — a full-body emissive wash would flood
the livery out of existence. See `applyShipConfig` in `packages/engine/src/ship/materials.ts`.

### Afterburner

Every hull carries an engine plume (`packages/engine/src/fx/afterburner.ts`): two additive quads crossed
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

Two things about these scans are easy to get wrong (see `packages/engine/src/ship/fbx-ship.ts`):

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

The game is split between a browser client and an authoritative server, and the
line between them runs through eleven workspace packages plus the Next.js
shell in `src/`. One glyph names each — `scripts/aliases.mjs` generates every
`tsconfig.json`'s `paths` from a `GLYPH` table and a `DEPS` table of who may
import whom, so an import of anything above a package in the DAG is a compile
error rather than a boot-time surprise:

```
packages/physics/      Φ  the hovercraft sim + the headless engine core (leaf)
packages/net/          Ξ  the netcode: clock, interpolation, prediction, bit-packed codec (leaf)
packages/data/         Ð  Drizzle over Neon; PGlite for tests (leaf)
packages/race/         Λ  RaceSim, track data, the race room
packages/battle/       Ψ  BattleSim, weapons, arena data, the battle room
packages/core/         Ȼ  ship registry, palettes, tuning helpers, track metadata
packages/state/        Ƨ  client state on threejs-scene stores
packages/engine/       Σ  the client runtime — vanilla three.js, no React below this line
  scenes/base.ts          the one composition root that stays here
  net/                    the client's netcode binding + shared prediction
  race/ battle/           per-mode transports and visuals
  hud/                    the shared canvas-owned race and battle HUD (see below)
  levels/                 the four tracks' MESHES (the data is in packages/race)
  modules/                publish.ts, publish-battle.ts, ship-visual.ts, sun.ts, physics-step.ts
  camera/rig.ts           chase + cockpit camera, as two blended stations
  bridge.ts               client stores -> app state, one direction only
  dev/                    dev-only debug harness; dropped from production builds
packages/game/          Ɠ  composition roots: mountRace, mountBattle, mountHangar, mountCrashLab
packages/ui/            Ʊ  React components and hooks; scene-canvas.tsx is the ONLY React<->three boundary
packages/server/        §  Colyseus boot — defines the two rooms

scripts/dev-cli.mjs        drive the running game from a shell (see below)
scripts/aliases.mjs        the `paths` generator — `bun run aliases` / `aliases:check`
```

`physics`, `net` and `data` are the only true leaves. Every other package's
`paths` lists exactly its declared dependencies' glyphs, and none of them ever
includes `Δ` — `src/`'s own glyph — so nothing crosses from a package back
into `src/`.

State flows one way: `Ƨ` stores -> bridge -> app state -> `module.update()` -> scene. Modules read
state and never write it. Engine *outputs* (speed, boost, lap times) travel back out through the
publish modules (`publish.ts` for race, `publish-battle.ts` for battle) on a throttled schedule,
and the two sets of fields are disjoint, so there is no feedback loop.

**Simulation runs at a fixed 60 Hz and rendering is interpolated.** `packages/physics/src/clock.ts`
mirrors the library's fixed-step arithmetic but also exposes the leftover accumulator as `alpha()`;
the root `render` hook samples each body's pose between its previous and current transform at that
alpha. Without this the ship stair-steps on a 120 Hz display — sampling the raw
`body.translation()` shows the same transform for two frames running.

### Styling

Plain CSS. No utility framework, no component library, no preprocessor.

- `src/app/globals.css` — design tokens and the reset. Colours are declared twice: a bare HSL
  triple (`--accent-hsl`) and a finished colour (`--accent`). The triple exists so a rule can
  compose an alpha variant, `hsl(var(--accent-hsl) / 0.3)`.
- HUD presentation tokens live in `packages/engine/src/hud/tokens.ts`; the race and battle adapters
  share them without leaking game-state policy into the drawing primitives.
- `*.module.css` next to each component — scoped class names, no global collisions. Shared chrome
  within a file uses `composes:`.
- Form controls (range, color, text, select) are styled once in `globals.css`, since nearly every
  panel in the app is a stack of them.

Anything genuinely per-instance — a level's card gradient, a slider's fill width — is passed as a
CSS custom property in a `style` prop and consumed by one rule, rather than generating a class per
value.

## Physics & camera

The ship is **a thruster rig, not a vehicle controller**: every control is a force applied at a
point on the hull (`packages/physics/src/thrusters.ts` is the hardware, `vehicle-step.ts` decides
each nozzle's throttle and applies `addForceAtPoint`), and four hover pads each cast their own ray
straight down, suspension-style, to hold the hull off the deck. Nothing sets a velocity or an
angular velocity to make the ship move — the only pose mutation left is a teleport. Tracks collide
via **cuboid box strips** (`packages/physics/src/colliders.ts`), not trimeshes: a trimesh would
have to register against the hover rays directly, and a thin strip is both cheaper and exact.

Staying upright is **load-bearing, not cosmetic**: a PD controller allocates differential lift
across the four hover pads on the ground, and an attitude couple in the air. Without it thrust
torques the ship onto its back within a second — the rig has no other torque canceling that
tendency. `bun run test:physics` (`scripts/vehicle-physics.ts`) asserts exactly that, upright checks
at rest, under thrust, through a turn, and at the end of station keeping.

Turn and strafe authority are also shared physics contracts, not per-input multipliers. Ground yaw
peaks at `1.45 rad/s` and falls below 45°/s at maximum speed; strafe targets 14% of cruise speed with
an eased response. `packages/race/scenarios/turn-response.json` and `strafe-response.json` pin their
two-second traces on The Flats, so keyboard, pointer, touch, race, and battle stay aligned.

### Two stations, one rig

`packages/engine/src/camera/rig.ts` holds a single `PerspectiveCamera` and two **stations** — `CHASE` and
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

`packages/engine/src/hud/` is a standalone canvas-owned GUI system shared by race and battle. It adapts each
mode into one `HudData` contract, then places seven interactive canvas readouts over one folded visor.
Three upper readouts use open canopy brackets, three lower readouts use closed MFD surfaces, and the
targeting pane recesses between them. Their independent bounds cluster both utility screens left, keep
the systems bank right, and leave the sightline open. A nine-cell translucent backing still makes the
cockpit one continuous glass surface. The six outer silhouettes are stored as normalised vector traces,
so their sparse strokes and asymmetric tapers stay crisp without shipping a reference bitmap. A separate
camera-locked screen plane owns transient layers:
countdown, finish and scoreboard states, errors, toasts, tuning, crash flash, and touch controls.

- `tokens.ts` is the semantic palette — amber as the primary cockpit holo colour (the cockpit's own
  light), cyan reserved as the contrast accent (targets, gates, friendlies), red for alerts and
  enemies, green for locked/ready — plus typography, cadence, and the tuning specification.
  `chrome.ts` turns those tokens into the visor's shared drawing vocabulary: cut-corner plates,
  doubled strokes, corner brackets, glow, and the rolling scanline every panel, the overlay, and the
  touch controls draw through, so the three surfaces read as one instrument rather than lookalikes.
- `panel.ts` owns canvas textures, drawing primitives, and hit regions; `facets.ts` owns the seven
  live-data layouts; `layout.ts` owns the continuous visor topology; `overlay.ts` owns full-screen
  and touch layers.
- `spatial-hud.ts` owns ship-station anchoring, raycast/UV hit testing, pointer capture, multitouch,
  and disposal. Pointer-look pans the camera across the stationary visor, while only the transient
  screen plane remains camera-locked. Panels upload at 12 Hz and the active overlay at up to 30 Hz.
- `index.ts` contains thin race and battle adapters. The renderer never imports scene-specific
  simulation internals, and React never subscribes to pointer-rate input.
- Every facet displays live session, vehicle, target, objective, weapon, or control data and exposes
  at least one useful canvas interaction; no decorative percentages or placeholder traces remain.
- Facet shaders add restrained scanlines, interference, chromatic separation, and angle-dependent
  gain over transparent canvas ink. They remain depth-independent and `toneMapped: false`, keeping
  cockpit colour legible through the scene composer without adding a dedicated bloom path.

The race and battle routes intentionally render no interactive DOM outside the WebGL canvas.
Accessibility metadata lives on the canvas itself, while keyboard, mouse, pen, and touch all write
the same mutable `Controls` object used by the simulation.

State is read **imperatively** — `telemetry` directly, and the HUD store's `getState()` per frame.
Subscribing would put a React commit in the render path, which is the exact thing the throttling in
the publish module exists to avoid.

### Race clocks

`raceTimers` in `packages/state/src/race.ts` is a plain mutable object, for the same reason
`packages/engine/src/telemetry.ts` is: the clocks advance every 60 Hz sim step, and writing them into a store
at that rate forced 60 React commits a second — which quietly defeated the 15 Hz throttling
elsewhere. The canvas HUD reads the live object and stays exact to the millisecond; the store mirrors
it on a throttle for other consumers. Lap times are taken from the live clock at the instant of the
crossing, never from the throttled copy.

### Live tuning

The race HUD carries a canvas-native **tuning panel** over the seven physics knobs that used to live
in Leva. It persists to `localStorage`, so a tuning session survives a reload, and **copy as TS**
emits just the values that moved as a block you paste into `vehicleConfig` in
`packages/physics/src/config.ts`.

## Debugging & dev tooling

The race scene exposes a debug harness at `window.__dev` in development, and
`scripts/dev-cli.mjs` drives it from a shell. It reuses a dev server already
listening on :9002 and starts one otherwise.

```bash
bun run dev:probe --level flats             # full state snapshot as JSON
bun run dev:shot /tmp/a.png --step 300 --overlay colliders,forces
bun run dev:console --seconds 5             # errors, frame times, WebGL state
bun run dev:eval -e '__dev.probe().ship.up'
```

Determinism checks are headless and never open a browser:

```bash
bun run dev:scenario straight-line           # race, run twice, hashes compared
bun run dev:scenario turn-response           # isolated steering authority
bun run dev:replay point-blank               # battle, same
```

### Scenarios

A scenario is a JSON input timeline — "throttle at 0 s, hard left at 5 s,
straighten at 7 s" — replayed against a fresh sim with no wall clock and no
browser. Twelve sim seconds complete in tens of milliseconds, and because the
simulation is deterministic two runs produce byte-identical traces. A handling
change becomes a diff rather than an opinion.

```
packages/race/scenarios/     straight-line, hard-corner, turn-response, …
packages/battle/scenarios/   point-blank, straight-fight
```

```jsonc
{
  "name": "hard-corner",
  "track": "neon-canyon",
  "ticks": 960,            // 16 sim seconds at 60 Hz
  "countdown": 0,
  "racers": [
    { "name": "Probe", "shipId": "icaras", "at": [0, 2, 0], "yaw": 0 }
  ],
  "timeline": [
    { "tick": 0,   "racer": 0, "input": { "throttle": true } },
    { "tick": 300, "racer": 0, "input": { "steer": -1, "strafe": 0.5 } },
    { "tick": 420, "racer": 0, "input": { "steer": 0, "boost": true } }
  ]
}
```

The default output is a summary — the hash, whether two runs agreed, and where
each racer ended up. `--json` prints everything; `--runs N` replays more than
twice.

**Reproducibility is maintained rather than inherited**, and the way it is paid
for changed. Race's scenarios used to run *in the page*, so every run inherited
whatever state the tab had accumulated and the runner had to explicitly reset
six things first — body pose, settle ticks, the race store, telemetry, a zone
accumulator, two held axes — every one of which was found by diffing two runs
that should have matched. Both harnesses now build a **fresh sim per run**, so
there is no reset list to forget. The rule that replaced it: keep new sim state
constructor-initialised.

Underneath that, `packages/physics/test/determinism.test.ts` hashes rapier's own
`world.takeSnapshot()` and asserts two runs match — the physics engine's
cross-platform claim holds only for the enhanced-determinism build at an exact
pin, so it is tested rather than trusted.

### Debug overlays

`--overlay` (or `?overlay=` on the URL) draws rapier collider wireframes, the four hover rays with
their hit points and surface normals, contact manifolds, the ship's path, per-thruster force
vectors and the net force/torque, and a helper on the sun's shadow camera — the last being the
direct check for "has the ship driven out of the shadow frustum again".

### URL overrides

`?seed=` `?paused=1` `?overlay=colliders,forces` `?nohud=1` `?tuning=<base64>`
— so any bug report can be a link that reproduces it exactly.

None of this exists in production: it sits behind `NODE_ENV !== 'production'`
and loads through a dynamic import, so the whole chunk is dropped from the
build.

## Deploying

Two halves, and they are not the same shape.

**The client and the account endpoints go on Vercel.** `bun install && bun run
build`; all dependencies are public. Install **Neon** from the Vercel
Marketplace and it injects `DATABASE_URL` (pooled), `DATABASE_URL_UNPOOLED`, the
`PG*` pieces and the legacy `POSTGRES_*` aliases — nothing to configure by hand.
Turn on preview branching while you are there, or every preview deployment
writes to the production database, registrations included.

Two secrets are **not** injected and have to be set by hand, on every
environment that should be able to sign anyone in:

```bash
vercel env add AUTH_SECRET       production preview   # openssl rand -base64 32
vercel env add GAME_TOKEN_SECRET production preview   # same again
```

Neither has a safe default and neither fails at build time — the deployment
goes green and then answers 500 on `/api/auth/*` and `/api/game/ticket`, which
is precisely what the first deploy of the netcode refactor did. `AUTH_SECRET`
is Auth.js's signing key; `GAME_TOKEN_SECRET` signs the join ticket and must
match the game server's copy exactly.

The failure degrades as well as it can: a broken `AUTH_SECRET` seats guests
rather than refusing everyone, and a missing `GAME_TOKEN_SECRET` answers 503
naming itself rather than a bare 500. Guests can still play through both. But
nobody can sign in until they are set.

Then apply the migrations once, against the direct connection:

```bash
bun run db:generate                                   # only after a schema edit
DATABASE_URL_UNPOOLED='postgres://…' bun run db:migrate
```

`db:generate` turns `packages/data/src/schema.ts` into SQL under
`packages/data/drizzle/`; `db:migrate` applies whatever has not been applied.
Migrations are deliberately *not* in the build command: one that fails should
not fail an otherwise-fine build, and there is no rollback. Each preview branch
needs its own run.

**The game server goes anywhere that runs a long-lived process** — Fly, Railway,
a box. It is a persistent stateful simulation looping at 60 Hz, which is exactly
what a serverless host cannot run. Give it:

- `GAME_TOKEN_SECRET` — the *same* value as Vercel. The Next app mints a
  sixty-second join ticket with it and this process verifies it. A mismatch
  does not error anywhere: every sign-in still succeeds and every pilot silently
  lands as a guest.
- `DATABASE_URL` — the same Neon database as Vercel, so a match recorded here
  shows up in the stats served there. Without it the server falls back to
  PGlite and match history goes away with the process.

And tell the client where it is, with `NEXT_PUBLIC_GAME_SERVER_URL=wss://…` on
Vercel. `wss://`, not `ws://`, or the browser blocks the socket as mixed
content.

Colyseus handles CORS and origin checking itself, so there is no allowlist to
keep in sync with Vercel's preview hostnames any more.

`.env.example` documents every variable either half reads.

> If an install ever starts failing with `401 Unauthorized` from `npm.pkg.github.com`, the cause is
> a resurrected `package-lock.json` carrying old `@tuomashatakka`-scoped entries. This project uses
> `bun.lock`; delete the npm lockfile rather than re-adding a `NODE_AUTH_TOKEN`.
