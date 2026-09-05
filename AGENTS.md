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
bun run dev:server   # the game server on :9003 (race AND battle)
bun run dev:all      # both, output prefixed, and they stop together
bun run aliases      # regenerate every package's tsconfig `paths` (scripts/aliases.mjs)
bun run aliases:check # CI: fails on a hand-edited tsconfig or an import leaving a package's src/
bun run typecheck    # tsc for the app and every package
bun run lint         # eslint src packages scripts test
bun run test         # vitest, one runner
bun run test:physics # standalone Rapier vehicle harness (scripts/vehicle-physics.ts)
bun run db:generate  # drizzle-kit: schema -> packages/data/drizzle/*.sql
bun run db:migrate   # apply them to Neon
bun run build
```

**EVERY mode is network-only** — race as well as battle. `bun run dev` alone
gets you a lobby that never connects; `bun run dev:all` is the one to reach for.
The server is a separate Bun process in `packages/server`, and it must be,
because it is a persistent stateful simulation: exactly what a serverless host
cannot run.

`src/` is the Next.js app shell — routes, API handlers, the server-only
helpers under `src/lib/`. Everything else is a workspace package under
`packages/*`, eleven of them, and the boundaries are enforced rather than
agreed. One glyph names each, `src/` included:

| glyph | package | owns |
| --- | --- | --- |
| `Δ` | `src/` | the Next.js app shell |
| `Ȼ` | `core` | ship registry, palettes, tuning helpers, track metadata, `CameraView` |
| `Ƨ` | `state` | client state on `threejs-scene` stores |
| `Σ` | `engine` | the client runtime: modules, HUD, netcode client, camera, FX, level meshes, ship assets |
| `Ɠ` | `game` | composition roots: `mountRace`, `mountBattle`, `mountHangar`, `mountCrashLab` |
| `Ʊ` | `ui` | React components and hooks |
| `Φ` | `physics` | the simulation core: three + rapier, nothing else |
| `Ξ` | `net` | the netcode, mode-agnostic: clock, codec, interpolation, rewind |
| `Λ` | `race` | RaceSim, track data, the Colyseus race room |
| `Ψ` | `battle` | BattleSim, weapons, arena data, the Colyseus battle room |
| `Ð` | `data` | Drizzle over Neon; PGlite for tests |
| `§` | `server` | Colyseus boot — defines the two rooms and gets out of the way |

`scripts/aliases.mjs` is the single source of truth: its `GLYPH` table names
each package and its `DEPS` table says who may import whom. From those two it
generates every package's `tsconfig.json` `paths` — a package's direct
dependencies, plus the transitive closure tsc needs to type what those pull
in, and nothing from above it in the DAG. `bun run aliases` regenerates every
`paths` block after adding a package or a dependency edge; `bun run
aliases:check` (which CI runs) fails on a tsconfig edited by hand instead of
generated, and on a relative import that leaves a package's own `src/` — a
boundary hole no `paths` entry can close. `physics`, `net` and `data` are the
only true leaves (their `paths` holds just themselves); every other package's
`paths` lists exactly its declared dependencies, so an import of a package
above it in the DAG — or of `Δ*`, `src/`'s own glyph — is a **compile error**
rather than something noticed when the server first tries to boot. Every
package also publishes an `exports` map, which is what makes
`@crash-velocity/race/room` resolve identically for bun, node and typescript.

**`packages/server` is Colyseus boot and nothing else.** It defines `race` and
`battle`, mounts `/rooms` and `/health`, and installs the process's one database
handle. What used to live there — a hand-rolled matchmaker, a ticket table, a
`/lobby` protocol, a room registry and a fixed-rate loop — is gone: Colyseus
does matchmaking, seat reservation, reconnection and room lifecycle, and the
rooms themselves moved beside the simulations they drive.

It runs on `@colyseus/bun-websockets`, so it stays a Bun process.

**`packages/data` is accounts and persistence, and it is a leaf.** Drizzle over
Neon, with PGlite — Postgres compiled to WASM, in-process — for tests and
offline work. Because PGlite speaks the *same dialect* as Neon there is no
second implementation to keep in agreement, which is why the old three-adapter
`Store` interface and its shared contract suite are both gone.

Its tsconfig sets `types: ["node"]` and `paths: {}`: this package runs under Bun
on the game server AND under Node on Vercel, so a stray `Bun.*` is a compile
error rather than a runtime surprise on whichever host hits it first.

**`packages/net` is the architecture document, as code.** NTP clock with slew,
buffered entity interpolation, the rewind buffer, the prediction error-smoother,
seat and baseline bookkeeping, and the bit-packed codec — smallest-three
quaternions, quantised positions, Quake-3 delta compression against the client's
last acknowledged snapshot. Nothing in it knows what a lap or a weapon is, which
is exactly why both modes can share a transport, a prediction loop and an
interpolator.

**`packages/physics` is the simulation, and it is a leaf.** It depends on
`three` and `@dimforge/rapier3d-deterministic-compat` and nothing else — no React, no zustand,
no DOM, no scene graph. Import it as `Φ`. `bun run
typecheck` checks it standalone with `paths: {}`, so a `Δ…` import inside it
is a build error rather than a thing someone notices later. It ships TypeScript
source and Next transpiles it (`transpilePackages`); there is no build step
between it and its two consumers, so there is no stale-dist failure mode.

**Every import goes through a glyph now — `@/…` and `@crash-velocity/*` import
specifiers no longer exist anywhere in the tree.** `Δ` is `src/`'s own glyph
(`Δlib/auth`); every workspace package answers to its own (`Φconfig`,
`Ψweapons`, `Ƨreact`, …), per the table above. There is no slash after a glyph
— the pattern substitutes `<glyph>*` → that package's `src/*`. A package with
a bare `index.ts` export (`physics`, `net`, `data`, `race`, `battle`, `server`,
`state`) also answers to the bare glyph (`Φ`, `Ξ`, `Ð`, `Λ`, `Ψ`, `§`, `Ƨ`);
`core`, `engine`, `game` and `ui` have no `index.ts` and are reached only
through `<glyph>*`.

## Debugging the live app

**Use the CLI, not browser screenshots.** `scripts/dev-cli.mjs` boots the game,
talks to the in-page `window.__dev` harness, and prints compact JSON. It reuses
a dev server already listening on :9002 and starts one otherwise.

```bash
bun run dev:probe --level flats             # full state snapshot, one JSON object
bun run dev:shot /tmp/a.png --step 300 --overlay colliders,forces
bun run dev:shot /tmp/b.png --level battle --at 0,3,-190   # frame a spot directly
bun run dev:console --seconds 5             # errors, frame times, WebGL state
bun run dev:eval -e '__dev.probe().ship.up'
bun run dev:shot /tmp/t.png --level battle --query touch=1,post=low
```

`--level battle` targets `/battle` rather than `/levels/<name>`. `--at x,y,z[,yaw]`
teleports before framing, which on a 600-unit deck beats driving there.

Because every mode is network-only, the CLI starts a game server if one is not
already listening, with `DB_DRIVER=pglite` so a probe never writes to a real
database and never fails because a `DATABASE_URL` happens to be exported.

`window.__devBattle`'s `place()` and `face()` are gone with the hand-rolled
protocol. They existed to poke a running match from a script;
`@colyseus/playground` (mounted at `/playground` in dev) joins a real room and
does it without a bespoke message family in the wire.

**Screenshots are slow here and that is the environment, not a bug.** Capturing
a post-processed WebGL canvas through ANGLE-on-SwiftShader costs ~7 s per
1280x720 frame with no GPU, against ~0.6 s for the same page with the canvas
removed — hence `SHOT_TIMEOUT` in `dev-cli.mjs`. In a sandbox whose chromium
build does not match playwright's pin, set `CHROMIUM_PATH` rather than
re-downloading half a gigabyte.

```bash
bun run dev:scenario straight-line    # headless race replay, twice, hashes compared
bun run dev:scenario turn-response    # isolated steering authority
bun run dev:scenario strafe-response  # isolated lateral authority
bun run dev:replay point-blank        # headless battle replay, same deal
bun run dev:replay straight-fight --json

bun run lab                           # every crash dummy, pass/fail per check
bun run lab wall-slam --dump          # one case, full trace to data/crash-lab/
bun run test:lab                      # all of them, twice, hashes compared
```

### The crash lab

Eight atomic physics cases, each in its own lane: a wall slam under boost, a
figure eight, a ramp jump, station keeping on a slope, brake-into-reverse, a
strafe off a ledge, a turbine-blown tube, and a stack of crates to shoulder
through. They live in `packages/physics/src/lab/`.

**One definition, two consumers.** `cases.ts` is pure data — geometry, spawn,
input timeline, and the checks — with no rapier, no rendering and no test
framework in it. `run.ts` runs a case headless and records EVERY tick, not a
sample. `packages/physics/test/crash-dummies.test.ts` turns the checks into assertions;
`/crash-lab` renders the same traces. If the watchable thing and the green thing
could disagree about what a case is, neither is worth much.

**The visual lab plays traces back, it does not simulate.** That is what makes
the scrubber exact, stepping BACKWARDS possible at all, and the arrows you pause
on the same forces the assertions ran against. `?lane=N` follows one dummy
close enough to read them.

A case that drives off the end of its deck respawns, which silently invalidates
every check after it — if a lane starts failing for no reason, check its floor
is still longer than the run.

`dev:replay` is battle's determinism check and has no browser in it at all. See
below.

Requires `bunx playwright install chromium` once. In a sandbox that already has
a chromium of a different build, set `CHROMIUM_PATH=/path/to/chrome` instead of
re-downloading one. First run against a cold server takes ~30 s; against a warm
one, ~6 s.

A **scenario** is a JSON input timeline. Both modes have them, both run
headless, and neither needs a browser:

```
packages/race/scenarios/     straight-line, hard-corner, turn-response, …
packages/battle/scenarios/   point-blank, straight-fight
```

They run in tens of milliseconds, and because the sim is deterministic two runs
produce byte-identical traces. That makes handling regressions diffable instead
of anecdotal.

This is a change worth understanding rather than just noting. Race's scenarios
used to run *in the page*, driving the real app with rendering switched off —
which meant booting a browser and a WebGL context to prove a simulation was
reproducible, and explicitly resetting six pieces of state before every run
(body pose, settle ticks, the race store, telemetry, a zone accumulator, two
held axes). Every one of those was found by diffing two runs that should have
matched. The headless harness builds a fresh sim per run instead, so there is
no reset list to forget.

The CLI runs a script twice and diffs the hashes; `deterministic: false` is the
bug to chase before anything else the summary says, because nothing past it
means anything. Beyond that, race's summary carries each racer's `position`,
`lap`, `gates`, `bestLap` and `finished`; battle's carries `scores` and each
player's `health`/`kills`/`deaths`. Whether the *ship itself* stayed upright
through a case is a different question, answered by the crash lab's own named
checks (`bun run lab`), not by a scenario summary field.

URL overrides in dev: `?seed=`, `?paused=1`, `?overlay=colliders,forces`,
`?nohud=1`, `?tuning=<base64>`. (`?scenario=` is gone with the browser runner.) Any reproduction can be
handed over as a link rather than a procedure.

Full reference, including the whole `window.__dev` surface:
`.claude/skills/debug-live/SKILL.md`.

### Determinism is maintained, not inherited

Reproducibility is **not** free, and the way this codebase pays for it changed.

It used to be paid at run time. Race's harness drove the real app in a page, so
every run inherited whatever state the tab had accumulated, and `runScenario`
had to explicitly reset six things before the timeline: the body pose, 60 settle
ticks to wash out rapier's warm-start impulses, the race store, telemetry
(`boostMeter` especially, which drains and never refills), the publish module's
zone-escalation accumulator, and the two held input axes. **Every one of those
was found by diffing two runs that should have matched** — not by reading the
code.

Both harnesses now build a **fresh sim per run**, because the reset nobody has
to write is the one nobody can forget. So the rule is no longer "remember to
reset it" but:

**Keep new sim state constructor-initialised.** If a field is set anywhere other
than the constructor, a replay can start from a different value than the run
before it, and the hash silently stops meaning anything.

Two harnesses, same shape, no browser in either:

- `packages/race/src/dev/replay.ts` — `bun run dev:scenario`
- `packages/battle/src/dev/replay.ts` — `bun run dev:replay`

Argument parsing, the run-twice-and-compare-hashes loop and the JSON/summary
printer are one shared `runReplayCli` in `packages/net/src/dev/replay-cli.ts`
(deliberately not in the `Ξ` barrel — a script, not something a sim imports);
`packages/race/src/dev/replay-cli.ts` and `packages/battle/src/dev/replay-cli.ts`
are now thin callers naming only what a script IS, how to run one, and which
extra summary fields belong to that mode.

Both feed a scripted input timeline to a sim with no wall clock at all and hash
the result; two runs of one script must match. A differing hash is the bug to
chase before any other, because **the client predicts these simulations** — it
runs the same `stepHovercraft` at the same `dt` and reconciles against the
server. If a match is not reproducible from its input stream, no amount of
reconciliation keeps the two halves in step.

Underneath both sits the physics engine itself. Rapier's cross-platform
determinism is a vendor claim that holds only for the enhanced-determinism
build, at an identical version, with identical construction and step order — so
`packages/physics/test/determinism.test.ts` hashes `world.takeSnapshot()` and asserts two runs
match, rather than trusting it. (The architecture document cites
`createSnapshot()`, which is the name in Rapier's *Rust* docs; the JavaScript
binding calls it `takeSnapshot()`.) That test also asserts the dependency is
`@dimforge/rapier3d-deterministic-compat` at an exact pin: the SIMD build is
explicitly not cross-platform deterministic, and nothing else in the suite would
notice the swap — it would keep passing on one machine and desync between two.

One trap the scenarios record: the Apex Spire's footprint is 164×148 around the
origin, so the obvious "put both ships on the centreline" setup buries them
*inside* a mesa and every shot fails line-of-sight for the wrong reason. The
open lane at `z = -230` is clear. `packages/battle/test/sim.test.ts` learned
this the same way.

## Architecture rules

These are the constraints that are expensive to rediscover.

**Data flows one way.** `Ƨ` stores → `app.setState` (via
`packages/engine/src/bridge.ts`) → modules read state. Modules never write
state. Sim *outputs* go the other way through
`packages/engine/src/modules/publish.ts` (race) and `publish-battle.ts`
(battle), throttled to their own cadence — writing telemetry into a store at
60 Hz costs 60 React commits a second.

**Client state is `threejs-scene` state.** Every store in `packages/state/src/`
is the library's `createStore`, the same primitive each `App` keeps its own
state in, wrapped once by `defineStore` for slice subscriptions and
localStorage. There is no zustand. The layout is fixed: every state *type* is
in `packages/state/src/types.ts`, every initial value and constant in
`defaults.ts`, and each domain file holds its store plus the actions that
write it (`raceStore` + `raceActions`). React reads a store with
`useStoreState` from `Ƨreact`; the engine reads it with `store.get()` and
subscribes with `store.select`. A type or constant declared anywhere else is a
duplicate waiting to drift.

**Controls.** `Q/E` and the arrows turn, `A/D` strafe, `R/F` walk the vertical
aim, `Backspace` respawns. `R` used to be respawn and `F` used to be battle's
fire-primary; both moved. `controls.pitch` is a raw held axis and each mode owns
its own policy — race springs it back to level in the render phase, battle
integrates it into `BattlePlayer.aimAngle` inside the sim so the trim holds, is
deterministic, and survives the netcode. In battle it feeds `BattleSim.aimOf`,
which is what lock acquisition and both weapons aim along; `forwardOf` stays the
true hull facing and is what the muzzle position uses.

**The ship is a thruster rig, not a vehicle controller.** Every control is a
force applied at a point on the hull — `packages/physics/src/thrusters.ts` is
the hardware, `vehicle-step.ts` decides each nozzle's throttle and applies
`addForceAtPoint`. Nothing sets a velocity or an angular velocity to make the
ship move; the only pose mutation left is a teleport. It used to be a rapier
`DynamicRayCastVehicleController` with `setLinvel` for strafe and `setAngvel`
for yaw AND upright, which meant no coupling between anything and no momentum
doing work.

**The rig's geometry IS the handling model.** A lateral nozzle sits aft of and
above the COM, so a strafe cannot happen without also yawing the nose into it,
banking into it, and dipping the nose — all three fall out of `tau = r x F`.
There is no downstream code adding those effects, so moving a mount point
changes how the ship drives and nothing else will notice.
`packages/physics/test/thrusters.test.ts` pins the signs; change a position and read what it says.

**Handling authority lives in shared physics.** Race and battle both call
`stepHovercraft`, so turn/strafe feel belongs in `vehicleConfig`,
`thrusters.ts` and `vehicle-step.ts`, never in one input path. Verify changes
with the `turn-response` and `strafe-response` scenarios and `bun run
test:physics`; do not tune keyboard, pointer, and touch independently.

**Forces must accumulate before `world.step()`**, so each mode's prediction
module (`race-net` / `battle-net` in `packages/game/src/{race,battle}.ts`,
which calls `stepHovercraft` via `LocalPrediction.step`) has to precede
`physics-step` in the module array. This is the same class of ordering
constraint as `postProcessing` being last, and it fails the same way: silently,
with the ship simply not responding.

**Hover rays must exclude sensors.** `QueryFilterFlags.EXCLUDE_SENSORS` is on
the hover raycast because without it the pads find "ground" on top of any sensor
and fire at full force. Race's checkpoint gates were the original reason — they
were eight-metre sensor cuboids sitting on the racing line — and they are an
analytic plane test now, but the flag stays: the arena still has sensors, and
this is a cheap guard against a class of bug that presents as "the ship
mysteriously flies".

**Downforce is load-bearing.** A hover pad can only push UP, so once the ship
crests a rise and the pads run out of reach there is no force available to put
it back on the track — it ramps off every undulation and keeps going. The `v^2`
downforce term in `DRAG`/`DOWNFORCE` is what plants it. Removing it looks like
tidying and turns the track into a launch ramp.

**Touch is a third path onto the same `Controls` object.** The standalone spatial
HUD (`packages/engine/src/hud/`) draws twin sticks and action buttons into its screen
plane, then writes through native pointer listeners — never React state, because
a `useState` per pointermove re-renders at thumb rate. Weapon triggers live on
`Controls` (`fire`, `fireSecondary`) rather than in `battle.ts` so keys, mouse,
and touch agree. The rail is drawn for **everyone**, desktop included — there is
no device sniff left to get a machine wrong, and `wantsTouchControls` is now one
line. `?touch=0` is the only way to turn it off; `?touch=1` additionally paints
the diagnostic readout, and `dev-cli --query touch=1` reaches it.

**Post-processing extends through `BaseSceneConfig.postEffects`.** Battle's chain
lives in `packages/engine/src/battle/post.ts`. Two traps it documents: nothing may sample
the composer's shared depth texture (it is attached to both render targets, so
binding it while writing renders the frame black with no error — this is why
there is no motion blur), and `createGodRaysPass` without a dedicated occlusion
buffer treats every emissive in the arena as a light source.

**Additive geometry the camera can enter will wash the frame.** Commit `07cff7e`
found it with the zone beacons; a horizon-glow cylinder around the deck hit it
again at arena scale. If it surrounds the play area it belongs in the sky shader,
not in the scene graph.

**Module order in `base.ts` is load-bearing.** `postProcessing` must be last:
the last-mounted module with a render hook wins, and it owns the composer. The
rapier world and the clock are built *before* `createApp` and injected, because
`createApp` builds and updates modules from one ordered array, so "built first,
stepped last" is unsatisfiable as a module.

**There is no vehicle module any more.** `modules/vehicle.ts` owned the ship —
built the body, stepped it, wrote telemetry, drove the camera — and both modes
are network-backed now, so neither uses it. The body belongs to the prediction
and the motion belongs to the server. What survived is
`packages/engine/src/vehicle.ts`: the `VehicleHandle` the rest of the engine
reaches the local ship through, and the `VehicleDebug` payload the force
overlay draws.

**Fixed timestep, manual interpolation.** `STEP = 1/60` in
`packages/physics/src/clock.ts` is the clock step, `world.timestep`, and the
vehicle `dt` simultaneously.
Rendering samples `BodyInterpolator.sample(clock.alpha(), …)` — never the raw
body, or poses stair-step above 60 Hz. After any `setTranslation`/`setRotation`,
call `interpolator.teleport()` or the ship visibly smears to the new pose.

**Station keeping is throttle AND brake together.** Holding both is not a
contradiction — mains lit, air brakes out, the difference trimmed to hold
position — and it is how you park an airframe with no wheels. The trim band is
deliberately tight: proportional control against a steady disturbance leaves a
standing error, and a wide band on a slope becomes a slow permanent creep.

**Anything outside the ship pushes it through `externalForce`.** Wind, turbine
wash, a blast. It is applied at the COM and recorded as a `'wind'` force sample
so the debug arrows can see it — a force the overlay cannot draw is a force that
defeats the point of the overlay. It must be a pure function of tick and pose
upstream or determinism goes with it.

**Colliders must be cuboids.** Track collision is box strips
(`packages/physics/src/colliders.ts`), not a trimesh.

**And a strip box is sunk by its own half-thickness**, so its TOP face is flush
with the ribbon the mesh draws (`boxColliderFromRing`). Centring it on the
surface instead — which it did — floats the drivable plane half a thickness
above the visible road, and because the offset follows the segment's local up,
on a banked corner it drifts sideways too. The route you drove was not the route
you saw. `flats.ts` hand-authors the same shift for its ground slab; anything
new that emits a collider owes the surface the same courtesy.

**A collider with no mesh is a bug, not a shortcut.** The flats deck had four
invisible perimeter walls for a long time. Levels now build the fence mesh FROM
the wall collider list, the way `arena.ts` builds its ramps from
`plateauColliders`, so the two cannot drift.

**The upright control is not cosmetic** — it is now a PD controller allocated
across the four hover pads as differential lift, and airborne as an attitude
couple. It is still what keeps thrust from putting the ship on its back. It
cannot go back to being a `setAngvel`: overwriting angular velocity means no
other torque on the hull can do anything, which is what made every other force
decorative.

**Yaw sign lives in the vehicle step.** `steer` is negated exactly once, in
`packages/physics/src/vehicle-step.ts`. +Y rotation is a LEFT turn.

**Shadows need both halves.** The sun module follows the ship
(`packages/engine/src/modules/sun.ts`) because a fixed shadow frustum loses it once the
ship drives out; and `castShadow` has to be set on every path that builds ship
geometry, not just the glTF one.

**Determinism is a feature.** Seeded rng with `fork(label)` per subsystem; no
`Math.random` anywhere inside the tick. Keep it that way — the scenario runner
and battle's client-side prediction both depend on it.

**Both modes are server-authoritative, and the client owns exactly two things.**
The rules, the physics and every outcome live in `packages/race` and
`packages/battle`, instantiated by the server. Each scene owns a *prediction* of
the local ship, so controls answer without waiting a round trip, and the
*rendering* of everyone else. There is **one rapier world on the client** — the
base scene's, holding the track or arena and the single predicted chassis.
Remote ships are interpolated transforms with no physics: their motion is the
server's to decide, and simulating it locally only produces a second,
disagreeing answer.

**Two channels carry a match, and neither can do the other's job.**
`@colyseus/schema` delta-encodes the slow half — roster, score, status, lap
counts, objectives — and handles late joiners and patches for free, at 20 Hz.
The bit-packed snapshot in `packages/net` carries poses, velocities and health
at 30 Hz, where smallest-three quaternions and quantised positions earn their
keep. Schema cannot quantise; a hand-rolled codec has no business
re-implementing map deltas and late-join replay. **`netIndex` is the join
between them** — the uint16 a ship is known by on the binary channel. Without it
a client cannot tell which decoded transform belongs to which roster entry.

Measured: 30.3 B/ship full, 11.3 B/ship delta, ~5.3 KB/s down for 16 ships at
30 Hz. A Schema patch is 7 bytes for a score change and 0 for an unchanged tick.

**Do not mark a Schema field `.unreliable()` on a WebSocket transport.** Colyseus
0.18 supports the marker — it is the document's channel split — but an
unreliable field over WebSocket is **never patched at all**, and the server says
so at boot. The lane exists only on `@colyseus/h3-transport` (WebTransport).
Marking the clocks and lock meters that way silently stopped them syncing.

**The server ticks at 60 Hz, not the 30 Hz the netcode literature suggests.**
`STEP` is simultaneously the client's clock step, `world.timestep` and the `dt`
`vehicleConfig` is tuned against, so any other server rate would change how every
ship handles *and* guarantee prediction divergence. Snapshots go out every second
tick (30 Hz).

**Remote ships render ~100 ms in the past, on server time.** Never apply a
snapshot straight to a remote transform — that is what makes a clean 30 Hz
stream look like a stuttering one. `NetBodyInterpolator.sampleAt` brackets the
two snapshots around `serverNow() − interpDelay`; `packages/net/src/clock.ts`'s
`NetClock` estimates `serverNow()` and **slews** corrections rather than jumping them, because an
offset applied instantly teleports every ship on screen.

**Prediction corrects in three tiers, and not more often.** Rapier's controllers
keep internal per-contact state they do not expose for snapshotting, so a replay
after a hard reset restarts from a state close to but not the server's —
correcting 30 times a second fights the solver continuously. Inside the deadband
the body is left alone; above it the correction replays unacknowledged input and
the visible jump decays away; past three metres continuity is a fiction and
everything snaps. See `packages/engine/src/net/prediction.ts`, shared by both modes.

**A replayed frame must go through the same converter the server applies.**
`toBattleInput` / `toRaceInput` live in their packages and are imported by both
halves precisely so the two cannot disagree about what `buttons & 2` means — a
divergence that would only show up on the ticks where somebody was shooting.

**Input is sent as a bundle of everything unacknowledged**, every tick, not just
what changed. A `dirty` flag sent a held throttle exactly once, so one dropped
packet left the server driving on stale input indefinitely.

**Only the fire pass is lag-compensated.** `BattleSim.lagCompensation` rewinds
hitboxes to what the shooter saw; the physics step must never see a rewound pose
or the world disagrees with where it just put things. A missile already in flight
travelled in server time, so its splash resolves against the present. The hit
geometry is pure and lives in `packages/battle/src/hitscan.ts` precisely so it
can run against supplied poses. Race has no rewind buffer at all — nothing is
ever resolved against a past tick.

**Projectiles are not networked entities.** The snapshot used to re-send every
missile's position and velocity at 30 Hz — a salvo of six cost more bandwidth
per tick than the six ships that fired them. They spawn from one reliable
`FireEvent` that both sides integrate identically, via `spawnProjectiles` in
`packages/battle/src/projectiles.ts`. That is only sound because the fan is
**index-derived, never drawn from `rng`**; a `Math.random()` in there would
desync every client silently. Beams go the same way, on the fire event, and are
aged locally. The client fires optimistically and despawns the phantom if no
confirmation arrives — the accepted Overwatch trade.

**A teleport is signalled by `respawnIndex` in the snapshot**, not by the `kill`
event. Blending an interpolator across a relocation draws a ship streaking over
the arena, and inferring it from an event means a dropped event causes the
smear.

**Anything a socket says is untrusted.** A malformed binary packet is *refused*,
not fatal — a decode that throws would take the room's whole message pump with
it, and an empty packet is the same thing as a lost one, which the input queue
already knows how to survive. Axes are clamped by the codec's quantisation, not
by a validator.

The 541-line hand-written wire protocol is gone: the Colyseus schema classes
**are** the contract now, and both halves import the same ones. The client
transport used to hand-type its own mirror of the server's format, which is how
a protocol drifts from the thing that produced it.

**A delta against a baseline the client no longer holds is undecodable, not
corrupt.** Forgetting the baseline makes the next acknowledgement ask for a full
snapshot, which the server sends unprompted — so it heals in one round trip
rather than killing the room. See `StaleBaselineError`.

**Styling is plain CSS.** No utility framework, no component library, no
preprocessor. Tailwind was removed on purpose.

## Layout

```
src/app/          Next routes. /levels/[level], /hangar, /lobby, /battle,
                  /crash-lab, /editor.
src/app/api/      Route handlers, and the only server-side code in the Next app:
                  auth/[...nextauth] (Auth.js), register, game/ticket.
src/lib/auth.ts   Auth.js configuration.
src/lib/net/      Browser-side account helpers.
src/lib/server/   Server-only. Never import from a client component.
scripts/          aliases.mjs (the glyph/DAG generator), dev-cli.mjs, dev-all.mjs,
                  crash-lab.ts, vehicle-physics.ts.

packages/physics/ The simulation, plus the headless engine core. A leaf —
                  depends only on three + rapier.
  src/config.ts   `vehicleConfig`.
  src/thrusters.ts  The rig as data — the geometry IS the handling model.
  src/vehicle-step.ts  One tick: sense, control, allocate, apply.
  src/rng.ts      `mulberry32` — the one seeded generator every sim draws from.
  src/{rapier,clock,world,colliders,interpolation}.ts
                  A rapier world, a fixed clock, a collider helper and the
                  render-interpolation buffer — the simulation's, not the
                  browser's.
  src/ships.ts    The hull roster, as identity only. `SHIP_PRESETS` in
                  `packages/core/src/ship/registry.ts` is typed
                  `Record<ShipId, …>`, so an id with no preset and a preset
                  with no id are both compile errors.
  src/lab/        The eight crash dummies and the headless runner.

packages/net/     The architecture document, as code. A leaf.
  src/codec/      bits, quantize (smallest-three quaternions), ship-state,
                  snapshot (delta vs the client's last ack, `buildSnapshot`), input.
  src/clock.ts    NTP-shaped offset estimate. Slews, never jumps.
  src/room-clock.ts  `pongFor` — the PING/PONG handshake, identical for every room.
  src/interpolation.ts  Buffered entity interpolation, 250 ms extrapolation clamp.
  src/prediction.ts     Pending-input ring + the three-tier error smoother.
  src/rewind.ts   Lag compensation, generic over the entity.
  src/seats.ts    Per-connection input bookkeeping and baseline history.
  src/rates.ts    Every rate, with the reason attached.
  src/dev/replay-cli.ts  `runReplayCli` — the shared CLI shell race's and
                  battle's own `dev/replay-cli.ts` call into. Not in the barrel.

packages/data/    Accounts and persistence, shared by Next and the server. A leaf.
  src/schema.ts   Every table, as Drizzle.
  src/client.ts   One `db` factory, three drivers (neon-http, neon-ws, pglite).
  src/repositories/  pilots, matches, stats.
  src/auth/       credentials, the scrypt hasher, and the join ticket.
  src/runtime.ts  The process's one database handle.
  drizzle/        Generated migrations. `bun run db:generate` writes them.

packages/race/    Depends on physics, net, data. Race's rules and world.
  src/sim.ts      RaceSim: N ships, N lap states, one rapier world.
  src/rules.ts    The lap state machine, as a pure reducer.
  src/track.ts, track-geometry.ts  TrackSpec + gates as an analytic plane test,
                  and `boxColliderFromRing`.
  src/levels/     The four tracks, as data (+ the ribbon geometry).
  src/room.ts     The Colyseus room. Server-only; not in the barrel.
  src/dev/        Headless replay harness + `dev/replay-cli.ts`.
  scenarios/      Replay scripts.

packages/battle/  Depends on physics, net, data. Battle's rules and world.
  src/sim.ts      The orchestrator: spawning, weapons, lag compensation.
  src/{zones,respawn,lock-on,scoring}.ts  Pure subsystems lifted out of
                  `sim.ts`, each a function of `(state, input, tick)` with its
                  own test file.
  src/weapons.ts, hitscan.ts, bot.ts, backfill.ts (bot backfill policy), arena.ts
  src/projectiles.ts  The deterministic salvo, run by BOTH halves.
  src/room.ts, state.ts, snapshot.ts, rewind.ts
  src/dev/, scenarios/

packages/core/    Depends on physics, battle. Domain configuration shared by
                  every layer above it.
  src/ship/       registry.ts (`SHIP_PRESETS`, one entry per ship), palettes.ts,
                  random-ranges.ts (the hangar's randomize ranges).
  src/camera.ts   `CameraView` (`'chase' | 'cockpit'`).
  src/levels.ts   Menu-facing level metadata (name, tagline, card accent).
  src/tuning.ts   Pure helpers behind the tuning panel's footer buttons.

packages/state/   Depends on core, physics, battle, race. Client state on
                  threejs-scene stores.
  src/types.ts    Every state type.
  src/defaults.ts Every initial value and constant.
  src/store.ts    `defineStore` — `createStore` wrapped with slice
                  subscriptions (`select`) and a localStorage envelope.
  src/react.ts    `useStoreState`, the only React entry point (`Ƨreact`).
  src/{gameplay,race,battle,ship,tuning,camera-view,hangar-view}.ts
                  One store plus the actions that write it, per domain.

packages/engine/  Depends on state, core, physics, net, race, battle. The
                  game's CLIENT half. Vanilla three + threejs-scene, no React.
                  Everything here is presentation or prediction; no rules.
  scenes/base.ts  The one composition root that stayed here — the shared scene
                  skeleton every mode's `mountX` in `packages/game/` builds on.
  net/            Shared client netcode: room-link.ts (the Colyseus binding),
                  prediction.ts, remote-hull.ts, ticket.ts, telemetry-publish.ts.
  race/           transport.ts — joins the two channels into one view.
  battle/         transport.ts, pools.ts, opponents.ts, projectiles.ts,
                  visuals.ts, plus the scenery and the post chain.
  levels/         The four tracks' MESHES. The data is in packages/race.
  modules/        AppModules: publish.ts, publish-battle.ts, sun.ts,
                  ship-visual.ts, physics-step.ts.
  ship/           FBX/generated hull loading and materials: cannons.ts,
                  fbx-ship.ts, icaras-generated.ts, materials.ts.
  hud/            Continuous visor GUI: tokens.ts (the amber cockpit palette,
                  `HUD_THEME`), chrome.ts (the shared drawing vocabulary —
                  plates, brackets, glow), panel.ts, facets.ts, layout.ts,
                  overlay.ts, spatial-hud.ts, index.ts (thin race/battle
                  adapters).
  dev/            Dev-only harness (harness.ts, overlay.ts, params.ts,
                  trace.ts). Excluded from production builds.
  camera/rig.ts   Chase + cockpit camera, as two blended stations.
  vehicle.ts      VehicleHandle / VehicleDebug — the handle the engine reaches
                  the local ship through.
  bridge.ts       Client stores -> app state, one direction only.

packages/game/    Depends on engine + everything below it. Composition roots.
  src/race.ts     `mountRace`.
  src/battle.ts   `mountBattle` — pools, opponents and the post chain wired
                  through `packages/engine/src/battle/`, store writes through
                  `modules/publish-battle.ts`.
  src/hangar.ts   `mountHangar`.
  src/crash-lab.ts  `mountCrashLab` — plays back `packages/physics/src/lab/`
                  traces; does not simulate.

packages/ui/      Depends on game + everything below it. React: the
                  components and hooks the Next.js routes render.
  src/scene-canvas.tsx   The ONLY React<->three boundary.
  src/main-menu.tsx, crash-lab.tsx, session-provider.tsx, scene-lifecycle.ts.
  src/hangar/, src/editor/   Panel components per route.
  src/hooks/      React-only hooks (use-gauge-animation.ts).

packages/server/  Colyseus boot. Defines the rooms and gets out of the way.
```

**Nothing crosses from a package back into `src/`.** The server used to import
engine code over the boundary (`Δengine/battle/sim` and friends) because the sim
lived in `src/`; it does not any more, and the generated `paths` in each
package's tsconfig — which never includes `Δ*` — is what keeps it that way.

## Conventions

- No semicolons; single quotes; aligned object values. `eslint --fix` settles
  most of it — run it rather than hand-formatting.
- Comments explain *why*, not *what*. The existing ones are the house style:
  they record the constraint or the bug that forced the code to be that shape.
- Dev-only code lives behind `process.env.NODE_ENV !== 'production'` and is
  reached via dynamic `import()`, so it is eliminated from production bundles.
  Verify with `grep -r "__dev" .next/static` after a build — it must be empty.
  The same grep is worth running for `drizzle-orm`, `@neondatabase` and
  `colyseus/core`: those are server-only, and a client chunk containing one
  means a package boundary leaked.
- **One test runner.** There were two, because `bun:sqlite` is a runtime builtin
  vitest's node process cannot load. The SQLite adapter is gone — PGlite speaks
  the same dialect as Neon and loads anywhere — so `bun test` and
  `packages/server/test-bun/` went with it. Everything runs under vitest.
- **A test suite that only asserts equality can pass against a constant.** The
  determinism cases each carry a companion assertion that the hash *changes*
  when the inputs do; do the same for any new one.
- **The thing to be suspicious of is code with tests and no callers.**
  `recordMatchStart/End/Players` existed, were covered by their own unit tests,
  and were called by nothing for the whole life of the feature — so `statsFor`
  returned zeroes and every test still passed.
  `packages/race/test/room.test.ts` is the shape that catches it: a real
  Colyseus room, a real Postgres, and an assertion about the number a player
  would actually see.

## Project agents

`.claude/agents/` defines this repo's subagents: `refactor-mechanic`,
`sim-surgeon`, `hud-artist`, `docs-sync` and `verifier`, each scoped to one
kind of change. Reach for the matching one rather than doing its job ad hoc.
