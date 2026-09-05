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
bun run dev:shot /tmp/a.png --step 300 --overlay colliders,forces
bun run dev:shot /tmp/b.png --level battle --at 0,3,-190
bun run dev:console --seconds 5             # errors, frame times, WebGL state
bun run dev:eval -e '__dev.probe().ship.up'
bun run lab                                 # crash dummies, pass/fail per check
bun run lab wall-slam --dump                # one case, full trace to data/
```

Determinism checks are **headless** and need no browser at all:

```bash
bun run dev:scenario straight-line          # race, twice, hashes compared
bun run dev:replay point-blank              # battle, same
```

`--level battle` drives `/battle`; `--at x,y,z[,yaw]` teleports before framing.
Set `CHROMIUM_PATH` if the sandbox's chromium build does not match playwright's.

**Every mode is network-only** — race as well as battle. `bun run dev:all`
starts the client and the server together; `dev-cli` starts the server itself.

The `debug-live` skill has the full `window.__dev` API, the scenario schema, and
what a summary field means. Invoke it when debugging runtime behaviour.

## Things that will bite you

- **bun, not npm.** Never create `package-lock.json`.
- **`postProcessing` must stay last** in the module array in `base.ts`.
- **After moving a body, call `interpolator.teleport()`** or it smears.
- **All ship motion is `addForceAtPoint`.** No `setLinvel`/`setAngvel` for
  control — see the thruster-rig rules in AGENTS.md. Forces must be applied
  before `world.step()`.
- **Six packages, and the boundaries are compiler-enforced.** `physics`, `net`,
  `race` and `battle` each set `"paths": {}`, so an `@/…` or `Δ…` import inside
  one fails the build rather than the boot. Nothing crosses from a package back
  into `src/`.
- **Adding persistent sim state? Constructor-initialise it.** Both replay
  harnesses build a fresh sim per run, so there is no reset list to update — but
  a field set anywhere else makes a run start from a different value than the
  one before it, and the hash silently stops meaning anything.
- **Physics debug layers are ON by default in dev**, with number keys 1-9 to
  toggle and 0 to clear. `?overlay=` (even empty) overrides the default.
- **Dev code must not ship.** After `bun run build`,
  `grep -r "__dev" .next/static` must return nothing. Same for `drizzle-orm`,
  `@neondatabase` and `colyseus/core` — those are server-only.
- **New imports use `Δ`, not `@`.** Both resolve to `src/`; no slash after the
  `Δ` (`Δengine/net/room-link`). Packages are imported by name.
- **No client ever simulates a remote ship.** One rapier world, one predicted
  chassis; everyone else is an interpolated transform.
- **Never mark a Colyseus Schema field `.unreliable()`** while the transport is
  WebSocket: the field is then never patched at all.
- **Rapier is the deterministic build, pinned exactly.** The SIMD build is not
  cross-platform deterministic and nothing but `test/determinism.test.ts` would
  notice the swap.

## Verifying a change

```bash
bun run typecheck && bun run lint && bun run test
bun run dev:scenario straight-line   # race handling still reproducible?
bun run dev:replay point-blank       # battle still deterministic?
bun run build                        # and check the leak greps above
```
