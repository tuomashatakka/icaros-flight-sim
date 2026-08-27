/**
 * `bun run dev:replay <name|path.json> [--runs 2] [--json]`
 *
 * Prints a summary by default and the full state on `--json`, matching what
 * `scripts/dev-cli.mjs` does for race scenarios: the governing rule there is
 * that defaults are summaries, and it applies just as much here.
 *
 * With `--runs 2` (the default) it replays the same script twice and compares
 * hashes, which is the actual check — a script that produces two different
 * hashes means determinism broke, and nothing else should be debugged first.
 */

import { basename, resolve } from 'node:path'
import { replayMatch } from './replay'
import type { ReplayScript, ReplaySummary } from './replay'


const SCENARIOS = resolve(import.meta.dir, '../../scenarios')

function usage (): never {
  process.stderr.write('usage: dev:replay <name|path.json> [--runs N] [--json]\n')
  process.exit(1)
}

const argv    = process.argv.slice(2)
const target  = argv.find(a => !a.startsWith('--'))
const asJson  = argv.includes('--json')
const runsArg = argv.indexOf('--runs')
const runs    = runsArg >= 0 ? Number.parseInt(argv[runsArg + 1] ?? '2', 10) : 2

if (!target || !Number.isFinite(runs) || runs < 1)
  usage()

const path = target.endsWith('.json') ? resolve(target) : resolve(SCENARIOS, `${target}.json`)
const file = Bun.file(path)

if (!await file.exists()) {
  process.stderr.write(`no such scenario: ${path}\n`)
  process.exit(1)
}

const script                   = await file.json() as ReplayScript
const results: ReplaySummary[] = []

for (let run = 0; run < runs; run++)
  results.push(await replayMatch(script))

const hashes        = [ ...new Set(results.map(r => r.hash)) ]
const deterministic = hashes.length === 1

if (asJson)
  process.stdout.write(`${JSON.stringify({ deterministic, results }, null, 2)}\n`)
else {
  const [ first ] = results
  process.stdout.write(`${JSON.stringify({
    scenario: basename(path),
    runs,
    deterministic,
    hash:     deterministic ? first.hash : hashes,
    ticks:    first.ticks,
    status:   first.status,
    scores:   first.scores,
    events:   first.eventCounts,
    players:  first.players.length,
  }, null, 2)}\n`)
}

if (!deterministic) {
  process.stderr.write(
    '\nDETERMINISM BROKEN: two runs of the same script diverged.\n' +
    'Per AGENTS.md this is a real bug and comes before anything else.\n'
  )
  process.exit(1)
}
