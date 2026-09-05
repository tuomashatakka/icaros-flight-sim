/**
 * `bun run dev:replay <name|path.json> [--runs 2] [--json]`
 *
 * Argument parsing, the run-twice-and-compare-hashes loop, and the JSON
 * output are `runReplayCli` in `@crash-velocity/net` — race's CLI is the
 * other caller. Only what a battle script IS and how to run one live here.
 */

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runReplayCli } from 'Ξdev/replay-cli'

import { replayMatch } from './replay'

import type { ReplayScript, ReplaySummary } from './replay'


// `node:` rather than `Bun.*` or `import.meta.dir`: this harness is the thing
// that proves the sim is reproducible, and it should not itself depend on which
// runtime happens to be running it.
const SCENARIOS = resolve(dirname(fileURLToPath(import.meta.url)), '../../scenarios')

await runReplayCli<ReplayScript, ReplaySummary>({
  command:      'dev:replay',
  scenariosDir: SCENARIOS,
  run:          replayMatch,
  extraFields:  first => ({
    scores:  first.scores,
    events:  first.eventCounts,
    players: first.players.length,
  }),
})
