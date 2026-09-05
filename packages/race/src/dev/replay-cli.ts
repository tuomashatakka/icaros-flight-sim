/**
 * `bun run dev:scenario <name|path.json> [--runs 2] [--json]`
 *
 * Argument parsing, the run-twice-and-compare-hashes loop, and the JSON
 * output are `runReplayCli` in `@crash-velocity/net` — battle's CLI is the
 * other caller. Only what a race script IS and how to run one live here.
 */

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runReplayCli } from 'Ξdev/replay-cli'

import { replayRace } from './replay'

import type { RaceReplayScript, RaceReplaySummary } from './replay'


// `node:` rather than `Bun.*` or `import.meta.dir`: this harness is the thing
// that proves the sim is reproducible, and it should not itself depend on which
// runtime happens to be running it.
const SCENARIOS = resolve(dirname(fileURLToPath(import.meta.url)), '../../scenarios')

await runReplayCli<RaceReplayScript, RaceReplaySummary>({
  command:      'dev:scenario',
  scenariosDir: SCENARIOS,
  run:          replayRace,
  extraFields:  first => ({
    track:  first.track,
    events: first.eventCounts,
    racers: first.racers.map(r => `P${r.position} ${r.name} lap ${r.lap} gates ${r.gates}${r.finished ? ' FINISHED' : ''}${r.bestLap === null ? '' : ` best ${r.bestLap}`}`),
  }),
})
