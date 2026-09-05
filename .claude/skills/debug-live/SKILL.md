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
bun run dev:shot <out.png> [--step N] [--overlay a,b] [--size 1280x720] [--nohud]
bun run dev:shot <out.png> --level crash-lab [--query lane=N]   # the crash lab
bun run lab [case] [--dump] [--twice]                           # headless dummies
bun run dev:console [--seconds 5]
bun run dev:eval -e '<javascript>'
```

Determinism checks are **headless** — no browser, no page, tens of milliseconds:

```bash
bun run dev:scenario <name|path.json> [--json] [--runs N]   # race
bun run dev:replay   <name|path.json> [--json] [--runs N]   # battle
```

Common flags for the browser commands: `--level` (flats | neon-canyon |
orbital-ring | procedural | battle | crash-lab), `--seed`, `--overlay`,
`--nohud`, `--size`, `--headed`.

Handling baselines: `bun run dev:scenario turn-response` isolates full steering;
`bun run dev:scenario strafe-response` isolates full lateral input.

**Every mode is network-only**, race included, so the CLI starts a game server
if one is not already listening (with `DB_DRIVER=pglite`, so a probe never
touches a real database).

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

A scenario is an input timeline, replayed against a fresh sim with no browser
and no wall clock — ~12 sim seconds in tens of milliseconds. The sim is
deterministic, so **two runs produce byte-identical traces**, and the CLI runs
it twice by default and compares hashes. That is the whole point: a handling
change is a diff, not an opinion.

```
packages/race/scenarios/     straight-line, hard-corner, turn-response, …
packages/battle/scenarios/   point-blank, straight-fight
```

```jsonc
{
  "name": "hard-corner",
  "track": "neon-canyon",
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

Nothing — and that is the point. Both harnesses build a **fresh sim per run**,
so there is no reset list to remember. `packages/race/src/dev/replay.ts` and
`packages/battle/src/dev/replay.ts` construct a new `RaceSim` / `BattleSim`,
feed it the scripted input timeline against a clock with no wall time in it,
and hash the result.

This replaced an in-page runner that drove the real app with rendering off and
had to reset six things first (body pose, 60 settle ticks, the race store,
telemetry, the publish module's zone accumulator, two held input axes). Every
one of those was found by diffing two runs that should have matched.

What is left is one rule: **keep persistent sim state constructor-initialised.**
A field assigned anywhere else lets a run start from a different value than the
one before it, and the hash silently stops meaning anything.

### Reading a summary

`deterministic` is the first thing to read: two runs of the same script must
produce the same `hash`. If it is `false`, nothing else in the output means
anything until you find out why.

Race (`dev:scenario`):

| Field | Means |
|---|---|
| `hash` | Trace digest. The whole point — identical across runs, diffable across commits |
| `ticks` | Sim steps executed, 60 per second |
| `status` | The race state machine at the end: `lobby`, `countdown`, `racing`, `finished` |
| `track` | Which track the script ran on |
| `events` / `eventCounts` | How many of each event fired: `countdown`, `raceStart`, `gate`, `lap`, `finish`, `respawn` |
| `racers[]` | Per-ship end state: `position`, `lap`, `gates`, `bestLap`, `finished`, and the final `x`/`y`/`z` |

Battle (`dev:replay`):

| Field | Means |
|---|---|
| `hash` / `ticks` / `status` | As above |
| `scores` | `{ red, blue }` at the end |
| `events` / `eventCounts` | `matchStart`, `fire`, `hit`, `lock`, `kill` |
| `players[]` | Per-player end state: team, health, kills, deaths, final pose |

A ship that drove off its deck shows up as a `respawn` event and a `y` back at
spawn height, not as a flag: the harness records what happened rather than
judging it. `--json` gives the full object above; the default output is the
same fields, formatted. The pass/fail checks live in the crash lab
(`bun run lab`), where each case declares what it expects.


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
setStatus('lobby'|'countdown'|'racing'|'finished')
overlay({ colliders, contacts, path, frustum,
          rays, forces, netForce, thrusters, com, velocity, inertia })

// Physics layers default to ON in a dev build; number keys 1-9 toggle one each
// and 0 clears them. An explicit ?overlay= wins, including an empty one.
trace()                     frame-time percentiles, errors, WebGL context state
raw                         live handles: app, physics, clock, controls, vehicle, rig
```

## URL overrides (dev only)

`?seed=` `?paused=1` `?overlay=colliders,forces` `?nohud=1` `?tuning=<base64>`

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
- **Screenshots are slow and that is the environment, not a bug.** Capturing a
  post-processed WebGL canvas through software GL costs ~7 s per frame with no
  GPU, against ~0.6 s for a page with no canvas. `dev-cli` allows 120 s for it.
- **Set `CHROMIUM_PATH`** when the sandbox's chromium build does not match the
  one playwright pinned, rather than re-downloading half a gigabyte.
- **`place()` and `face()` are gone** with the hand-rolled battle protocol.
  `@colyseus/playground`, mounted at `/playground` on the game server in dev,
  joins a real room and does the same job.

## Worked example

> "Does the ship survive a hard left at top speed on the canyon?"

```bash
bun run dev:scenario hard-corner
```

Read the summary: `deterministic: true` first — if it is false, nothing else in
the output means anything and that is the bug to chase. Then where each racer
ended up and how many gates they cleared. Then, to see it:

```bash
bun run dev:shot /tmp/corner.png --level neon-canyon --step 420 --overlay colliders,path
```
