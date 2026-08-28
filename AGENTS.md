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
bun run dev:server   # the battle server on :9003
bun run dev:all      # both, output prefixed, and they stop together
bun run typecheck    # tsc for the app AND packages/server
bun run lint         # eslint src packages scripts
bun run test         # vitest, then `bun test` for the runtime-specific suite
bun run test:physics # standalone Rapier vehicle harness
bun run build
```

**Battle mode is network-only.** `bun run dev` alone gets you a lobby that never
connects — `bun run dev:all` is the one to reach for. The server is a separate
Bun process in `packages/server`, and it must be, because it is a persistent
stateful simulation: exactly what a serverless host cannot run.

The workspace is `packages/*`. It has **no runtime dependencies** — `Bun.serve`
does HTTP and WebSocket, `bun:sqlite` is the database and `Bun.password` is the
hasher, so nothing is installed to do what the runtime already does.

**New code imports through `Δ`, not `@`.** Both aliases resolve to `src/`;
`Δengine/battle/sim` is the one to use going forward. There is no slash after
the `Δ` (the pattern substitutes `Δ*` → `./src/*`). The 40 files still on `@/`
work fine and are a separate mechanical pass, not something to fold into
unrelated work.

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

Because battle is network-only, `--level battle` also starts a battle server if
one is not already listening, with `DEV_COMMANDS=1` so `window.__devBattle`'s
`place()` and `face()` work — those are server requests now, and the server
ignores them without that flag.

```bash
bun run dev:replay point-blank        # headless match replay, twice, hashes compared
bun run dev:replay straight-fight --json
```

`dev:replay` is battle's determinism check and has no browser in it at all. See
below.

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

`runScenario` covers race only. It reads the race store throughout and
`deps.level` is undefined for battle, so battle has its own harness —
`packages/server/src/dev/replay.ts`, driven by `bun run dev:replay`. It feeds a
scripted input timeline to a `BattleSim` with no wall clock at all and hashes the
result; two runs of one script must match. Scripts live in
`packages/server/scenarios/`.

Battle sidesteps the reset problem rather than solving it: `replayMatch` builds a
fresh sim per run, because the reset nobody has to write is the one nobody can
forget. Keep new sim state constructor-initialised and that stays true.

Determinism matters more here than it does for race. **The client now predicts
this simulation** — it runs the same `stepHovercraft` at the same `dt` and
reconciles against the server. If a match is not reproducible from its input
stream, no amount of reconciliation keeps the two in step, so a replay hash that
differs between runs is the bug to chase before any other.

One trap the scenarios record: the Apex Spire's footprint is 164×148 around the
origin, so the obvious "put both ships on the centreline" setup buries them
*inside* a mesa and every shot fails line-of-sight for the wrong reason. The
open lane at `z = -230` is clear. `test/battle-sim.test.ts` learned this the
same way.

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
and battle's client-side prediction both depend on it.

**Battle is server-authoritative, and the client owns exactly two things.** The
rules, the physics and every outcome live in `packages/server`. The scene owns a
*prediction* of the local ship, so controls answer without waiting a round trip,
and the *rendering* of everyone else. There is **one rapier world on the
client** — the base scene's, holding the arena and the single predicted chassis.
Remote ships are interpolated transforms with no physics: their motion is the
server's to decide, and simulating it locally only produces a second,
disagreeing answer. (Battle used to build a second world with a second copy of
the arena colliders and step it from a different module in the same tick.)

**The server ticks at 60 Hz, not the 30 Hz the netcode literature suggests.**
`STEP` is simultaneously the client's clock step, `world.timestep` and the `dt`
`vehicleConfig` is tuned against, so any other server rate would change how every
ship handles *and* guarantee prediction divergence. Snapshots go out every second
tick (30 Hz).

**Remote ships render ~100 ms in the past, on server time.** Never apply a
snapshot straight to a remote transform — that is what makes a clean 30 Hz
stream look like a stuttering one. `NetBodyInterpolator.sampleAt` brackets the
two snapshots around `serverNow() − interpDelay`; `net-clock.ts` estimates
`serverNow()` and **slews** corrections rather than jumping them, because an
offset applied instantly teleports every ship on screen.

**Prediction corrects in three tiers, and not more often.** Rapier's
`DynamicRayCastVehicleController` keeps per-wheel suspension state it does not
expose for snapshotting, so a replay after a hard reset restarts from a state
close to but not the server's — correcting 30 times a second fights the
controller continuously. Inside the deadband the body is left alone; above it the
correction replays unacknowledged input and the visible jump decays away; past
three metres continuity is a fiction and everything snaps. See
`src/engine/battle/prediction.ts`.

**Input is sent as a bundle of everything unacknowledged**, every tick, not just
what changed. A `dirty` flag sent a held throttle exactly once, so one dropped
packet left the server driving on stale input indefinitely.

**Only the fire pass is lag-compensated.** `BattleSim.lagCompensation` rewinds
hitboxes to what the shooter saw; the physics step must never see a rewound pose
or the world disagrees with where it just put things. A missile already in flight
travelled in server time, so its splash resolves against the present. The hit
geometry is pure and lives in `src/engine/battle/hitscan.ts` precisely so it can
run against supplied poses.

**A teleport is signalled by `respawnIndex` in the snapshot**, not by the `kill`
event. Blending an interpolator across a relocation draws a ship streaking over
the arena, and inferring it from an event means a dropped event causes the
smear.

**Anything a socket says is untrusted.** Every inbound client message is parsed
through zod in `src/engine/battle/protocol.ts` before it reaches the sim. That
module is the single definition of the wire, shared by both halves — the client
transport used to hand-type its own mirror of a server that did not exist, which
is how a protocol drifts from the thing that produced it.

**Styling is plain CSS.** No utility framework, no component library, no
preprocessor. Tailwind was removed on purpose.

## Layout

```
src/app/          Next routes. /levels/[level], /hangar, /lobby, /battle.
src/components/   React. scene-canvas.tsx is the ONLY React↔three boundary.
src/engine/       The game. Vanilla three + threejs-scene, no React.
  scenes/         Composition roots (mountRace, mountHangar, mountBattle).
  modules/        AppModules: vehicle, race, publish, sun, ship-visual, physics-step.
  battle/         Arena, sim, weapons, bots — plus the netcode client:
                  protocol.ts (the wire, shared with the server), transport.ts,
                  net-clock.ts, prediction.ts, hitscan.ts.
  dev/            Dev-only harness. Excluded from production builds.
  hud/            Continuous visor GUI: live facets, overlays, hit testing, touch.
  levels/         The four tracks, as LevelSpec data.
  physics/        Rapier world + collider helpers.
src/hooks/        zustand stores.
src/lib/net/      Browser-side account and lobby clients.
public/scenarios/ Race scenario scripts for the CLI and ?scenario=.
scripts/          dev-cli.mjs, dev-all.mjs.

packages/server/  The authoritative battle server. Zero runtime dependencies.
  src/match/      Room, fixed-rate loop, bot backfill, lag-compensation rewind.
  src/lobby/      Matchmaker and the /lobby socket.
  src/auth/       Registration, login, sessions.
  src/store/      Store interface + sqlite and in-memory implementations.
  src/dev/        Headless replay harness (battle's determinism check).
  test/           vitest, alongside the rest of the repo.
  test-bun/       Runs under `bun test` — see Conventions.
  scenarios/      Replay scripts.
```

The server imports engine code across the boundary (`Δengine/battle/sim` and
friends) rather than duplicating it, which is why `BattleSim` stays in `src/`
even though only the server instantiates it.

## Conventions

- No semicolons; single quotes; aligned object values. `eslint --fix` settles
  most of it — run it rather than hand-formatting.
- Comments explain *why*, not *what*. The existing ones are the house style:
  they record the constraint or the bug that forced the code to be that shape.
- Dev-only code lives behind `process.env.NODE_ENV !== 'production'` and is
  reached via dynamic `import()`, so it is eliminated from production bundles.
  Verify with `grep -r "__dev" .next/static` after a build — it must be empty.
- **Two test runners, for one reason.** `Bun.password` and `bun:sqlite` are
  runtime builtins vitest's node process cannot load, so anything touching them
  lives in `packages/server/test-bun/` and runs under `bun test`. Everything
  else — including all the server logic — runs under vitest with the rest of the
  repo, against `MemoryStore`. `bun run test` runs both. If a new server test
  does not need the runtime, put it in `test/`, not `test-bun/`.
