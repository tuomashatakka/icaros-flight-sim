# CLAUDE.md

**Read [AGENTS.md](./AGENTS.md) first.** It is the canonical agent guide for this
repo — commands, architecture rules, layout, conventions. This file holds only
the always-loaded quick reference and the Claude Code specifics, so the two
cannot drift.

## Debugging the live app — use the CLI

Do **not** reach for browser screenshots or MCP browser tools to find out what
the game is doing. `scripts/dev-cli.mjs` boots it, drives the in-page
`window.__dev` harness, and returns compact JSON.

```bash
bun run dev:probe --level flats             # full state snapshot
bun run dev:scenario straight-line          # deterministic scripted run + summary
bun run dev:shot /tmp/a.png --step 300 --overlay colliders,wheels
bun run dev:shot /tmp/b.png --level battle --at 0,3,-190
bun run dev:console --seconds 5             # errors, frame times, WebGL state
bun run dev:eval -e '__dev.probe().ship.up'
bun run dev:replay point-blank              # battle determinism, no browser
```

`--level battle` drives `/battle`; `--at x,y,z[,yaw]` teleports before framing.
Set `CHROMIUM_PATH` if the sandbox's chromium build does not match playwright's.

**Battle mode is network-only** — it talks to the server in `packages/server`.
`bun run dev:all` starts the client and the server together; `dev-cli` starts
the server itself for `--level battle`.

Scenarios are input timelines in `public/scenarios/`, run with rendering off:
~12 sim seconds in ~20–40 ms, byte-identical across runs. Two runs of the same
script that differ mean determinism broke — that is a real bug, investigate it
before anything else.

The `debug-live` skill has the full `window.__dev` API, the scenario schema, and
what a summary field means. Invoke it when debugging runtime behaviour.

## Things that will bite you

- **bun, not npm.** Never create `package-lock.json`.
- **`postProcessing` must stay last** in `race.ts`'s module array.
- **After moving a body, call `interpolator.teleport()`** or it smears.
- **Adding persistent sim state?** Reset it in `runScenario`
  (`src/engine/dev/scenario.ts`) or scenarios silently stop being reproducible.
  Battle's equivalent is `packages/server/src/dev/replay.ts`, which builds a
  fresh sim per run — so keep new sim state constructor-initialised.
- **Dev code must not ship.** After `bun run build`,
  `grep -r "__dev" .next/static` must return nothing.
- **New imports use `Δ`, not `@`.** Both resolve to `src/`; no slash after the
  `Δ` (`Δengine/battle/sim`).
- **Battle's client never simulates a remote ship.** One rapier world, one
  predicted chassis; everyone else is an interpolated transform.
- **`packages/server/test-bun/` runs under `bun test`**, because `bun:sqlite`
  and `Bun.password` cannot load in vitest. Everything else goes in `test/`.

## Verifying a change

```bash
bun run typecheck && bun run lint && bun run test
bun run dev:scenario straight-line   # race handling still sane?
bun run dev:replay point-blank       # battle still deterministic?
bun run build                        # and check the leak grep above
```
