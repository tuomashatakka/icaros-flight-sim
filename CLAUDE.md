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
- **Eleven packages in a DAG, and the boundaries are compiler-enforced.** One
  glyph per package (`Φ` physics, `Ξ` net, `Ð` data, `Λ` race, `Ψ` battle, `Ȼ`
  core, `Ƨ` state, `Σ` engine, `Ɠ` game, `Ʊ` ui, `§` server), generated into
  every `tsconfig.json`'s `paths` by `scripts/aliases.mjs` from its `GLYPH`/
  `DEPS` tables — `bun run aliases` regenerates them, `bun run aliases:check`
  fails CI on a hand-edited one or on an import leaving a package's own
  `src/`. Nothing crosses from a package back into `src/`: no package's
  `paths` ever includes `Δ*`, so that import is a compile error, not a
  boot-time surprise. `@/…` and `@crash-velocity/*` import specifiers no
  longer exist anywhere in the tree.
- **Adding persistent sim state? Constructor-initialise it.** Both replay
  harnesses build a fresh sim per run, so there is no reset list to update — but
  a field set anywhere else makes a run start from a different value than the
  one before it, and the hash silently stops meaning anything.
- **Physics debug layers are ON by default in dev**, with number keys 1-9 to
  toggle and 0 to clear. `?overlay=` (even empty) overrides the default.
- **Dev code must not ship.** After `bun run build`,
  `grep -r "__dev" .next/static` must return nothing. Same for `drizzle-orm`,
  `@neondatabase` and `colyseus/core` — those are server-only.
- **New imports use the owning package's glyph, never `@`.** `Δ` is `src/`'s
  own glyph (`Δlib/auth`); every other package answers to its own
  (`Σnet/room-link`, `Φconfig`, `Ψweapons`, …) — no slash after the glyph.
- **No client ever simulates a remote ship.** One rapier world, one predicted
  chassis; everyone else is an interpolated transform.
- **Never mark a Colyseus Schema field `.unreliable()`** while the transport is
  WebSocket: the field is then never patched at all.
- **Rapier is the deterministic build, pinned exactly.** The SIMD build is not
  cross-platform deterministic and nothing but
  `packages/physics/test/determinism.test.ts` would notice the swap.

## Verifying a change

```bash
bun run aliases:check                        # tsconfig paths still generated, not hand-edited
bun run typecheck && bun run lint && bun run test
bun run dev:scenario straight-line   # race handling still reproducible?
bun run dev:replay point-blank       # battle still deterministic?
bun run build                        # and check the leak greps above
```
