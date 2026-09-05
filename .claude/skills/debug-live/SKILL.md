---
name: debug-live
description: Inspect, drive, and test the running Space Race game from the shell. Use whenever you need to know what the game is actually doing — reproducing a handling bug, checking whether the ship falls through a track, measuring speed or lap behaviour, capturing a screenshot, reading console errors, or verifying a physics/camera/HUD change end to end. Prefer this over browser screenshots or MCP browser tools for anything about this project's runtime behaviour.
---

# Debugging the live game

The game exposes a debug harness at `window.__dev` in development, and
`scripts/dev-cli.mjs` drives it from a shell. **Use the CLI.** Screenshotting a
3D scene through a browser tool and eyeballing it costs an order of magnitude
more context and tells you less.

The CLI reuses a dev server already listening on :9002 and starts one otherwise.
Cold start (spawning a server) is ~30 s; against a warm server each command is
~6 s.

## Commands

```bash
bun run dev:probe [--level flats]
bun run dev:scenario <name|path.json> [--json] [--out FILE] [--level L]
bun run dev:shot <out.png> [--step N] [--overlay a,b] [--size 1280x720] [--nohud]
bun run dev:shot <out.png> --level crash-lab [--query lane=N]   # the crash lab
bun run lab [case] [--dump] [--twice]                           # headless dummies
bun run dev:console [--seconds 5]
bun run dev:eval -e '<javascript>'
```

Common flags: `--level` (flats | neon-canyon | orbital-ring | procedural),
`--seed`, `--overlay`, `--nohud`, `--size`, `--headed`.

Handling baselines: `bun run dev:scenario turn-response` isolates full steering;
`bun run dev:scenario strafe-response` isolates full lateral input.

## Pick the right tool

| Question | Command |
|---|---|
| What is the game doing right now? | `dev:probe` |
| Does the ship handle correctly through X? | `dev:scenario` |
| Did my change break handling? | `dev:scenario … --out` twice, diff |
| Where are the colliders really? | `dev:shot --overlay colliders` |
| Are the hover rays reaching the ground? | `dev:shot --overlay rays` |
| Which nozzle is firing, and how hard? | `dev:shot --overlay forces` |
| Why is the ship drifting? | `dev:shot --overlay netForce` (white = sum force, red = net torque) |
| Did the ship leave the shadow frustum? | `dev:shot --overlay frustum` |
| Any errors? Is it slow? | `dev:console` |
| One specific value | `dev:eval -e '…'` |

## Scenarios

A scenario is an input timeline in `public/scenarios/`. It runs with rendering
disabled — ~12 sim seconds in ~40 ms — and the sim is deterministic, so **two
runs produce byte-identical traces**. That is the whole point: a handling change
is a diff, not an opinion.

```jsonc
{
  "name": "hard-corner",
  "level": "neon-canyon",
  "duration": 16,          // sim seconds
  "sampleEvery": 0.5,      // sim seconds per trace row
  "start": { "position": [0, 2, 0], "yaw": 0, "linvel": [0, 0, -20] },  // optional
  "tuning": { "thrust": 1200 },                                          // optional
  "autoStart": true,       // skip the 3-2-1; default true
  "timeline": [
    { "at": 0, "input": { "throttle": true } },
    { "at": 5, "input": { "steer": -1, "strafe": 0.5 } },
    { "at": 7, "input": { "steer": 0, "strafe": 0, "boost": true } },
    { "at": 9, "respawn": true }
  ]
}
```

Default output is the summary only. Reach for `--json` / `--out` when you
actually need per-sample rows.

### What a scenario resets

Reproducibility is not free — a run inherits state from however long the page
was live before it. The runner therefore resets, before the timeline starts:

- **body pose** to `start` or the race spawn, with zero velocity
- **60 settle ticks** with neutral input, to wash out rapier's warm-start
  impulses and the vehicle controller's per-wheel suspension state
- **the race store** (`resetRace()`) — lap, next checkpoint, respawn target
- **telemetry** — `boostMeter` especially, which drains and never refills
- **the publish module's** zone-escalation accumulator

Everything is restored afterwards, so running a scenario mid-race is safe.

If you add state that persists across ticks and is not reset here, scenarios
using it will silently become non-reproducible. That is the one invariant worth
protecting.

### Reading a summary

| Field | Means |
|---|---|
| `flipped` | Orientation failure — on its side or worse, persistently |
| `fellThrough` | Went below the track. Always a collision bug |
| `minUp` | 1 = level, 0 = on its side, -1 = inverted |
| `minY` / `maxY` | Height envelope |
| `airborneRatio` | Fraction of samples off the ground. **High is normal** for this ship |
| `maxSpeed` / `avgSpeed` | m/s. `avgSpeed` ignores samples under 0.5 m/s |
| `crashes` / `gatesPassed` / `finished` | Race progress |
| `distance` | Path length, m |

`flipped` and `fellThrough` are separate because their causes are: handling
versus collision. Thresholds are constants at the top of
`src/engine/dev/scenario.ts` — adjust there, not inline.

Note: a scenario that ends with `fellThrough: true` may be a bad *script* (full
throttle off a canyon edge) rather than an engine bug. Check `minUp` — if the
ship stayed level the whole way down, it drove off, it did not lose control.

## `window.__dev` API

For `dev:eval` and devtools. Everything returns JSON.

```
ready                       true once the scene has stepped
probe()                     pose, velocity, telemetry, race, render info, tuning
pause() / resume()          freeze the sim (clock.paused)
step(n)                     advance exactly n sim ticks while frozen, then draw
snapCamera()                cut the camera onto the ship — required before screenshots
teleport({ position, yaw|quaternion, linvel, angvel })
setInput({ steer, throttle, brake, boost })
respawn() / toggleView()
setTuning(partial) / resetTuning()
setStatus('idle'|'countdown'|'racing'|'finished')
scenario(script)            → Promise<trace>
overlay({ colliders, contacts, path, frustum,
          rays, forces, netForce, thrusters, com, velocity, inertia })

// Physics layers default to ON in a dev build; number keys 1-9 toggle one each
// and 0 clears them. An explicit ?overlay= wins, including an empty one.
trace()                     frame-time percentiles, errors, WebGL context state
raw                         live handles: app, physics, clock, controls, vehicle, rig
```

## URL overrides (dev only)

`?seed=` `?paused=1` `?overlay=colliders,forces` `?nohud=1` `?tuning=<base64>`
`?scenario=<name>`

Any reproduction can be handed over as a URL rather than a procedure.

## Gotchas

- **Screenshots need `snapCamera()`.** The sim is deterministic; the camera rig
  damps on real time and is not. `dev:shot` already does this — a hand-rolled
  screenshot will not be reproducible without it.
- **After any teleport, call `interpolator.teleport()`** or the render blends
  across the jump and the ship smears. `__dev.teleport()` handles it.
- **A `__dev never became ready` error is a mount failure**, not a slow load.
  The CLI prints the console tail with it; read that first.
- **`raw` is not JSON-serializable.** Do not return it from `page.evaluate`.
- **Nothing here exists in production** — it is all behind `NODE_ENV !==
  'production'` and loaded via dynamic import.

## Worked example

> "Does the ship survive a hard left at top speed on the canyon?"

```bash
bun run dev:scenario hard-corner
```

Read `summary`: `minUp` near 1 and `flipped: false` means the upright control
held. `fellThrough: true` with a high `minUp` means it drove off an edge — a
track/line problem, not a handling one. Then, to see it:

```bash
bun run dev:shot /tmp/corner.png --level neon-canyon --step 420 --overlay colliders,path
```
