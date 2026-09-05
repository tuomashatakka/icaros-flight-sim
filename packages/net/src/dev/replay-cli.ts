/**
 * Shared shell for both modes' headless replay CLIs.
 *
 * `bun run dev:scenario <name|path.json> [--runs 2] [--json]` (race) and
 * `bun run dev:replay <name|path.json> [--runs 2] [--json]` (battle) are two
 * callers of one argument parser, one run-twice-and-compare-hashes loop, and
 * one JSON/summary printer — the only things that differ are what a script
 * IS, how to run one, and which extra fields belong in the human-readable
 * summary. CI and other agents run both by name, so every line of output here
 * has to stay exactly what it was before this moved.
 */

import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'


export type ReplaySummaryBase = {
  hash:        string;
  ticks:       number;
  status:      string;
  eventCounts: Record<string, number>;
}

export type RunReplayCliOptions<Script, Summary extends ReplaySummaryBase> = {

  /** The bun script name, e.g. `dev:scenario` — appears in the usage line only. */
  command: string;

  /**
   * Absolute path to the mode's `scenarios/` directory.
   *
   * Resolved by the CALLER against its own `import.meta.url` — this module has
   * no scenarios of its own, and resolving here would resolve relative to the
   * wrong file.
   */
  scenariosDir: string;

  /** Run one script once and produce its hash + summary. */
  run (script: Script): Promise<Summary>;

  /** Mode-specific fields appended to the human-readable summary, after `status`. */
  extraFields (first: Summary): Record<string, unknown>;
}

export async function runReplayCli<Script, Summary extends ReplaySummaryBase> (
  options: RunReplayCliOptions<Script, Summary>,
): Promise<void> {
  const { command, scenariosDir, run, extraFields } = options

  function usage (): never {
    process.stderr.write(`usage: ${command} <name|path.json> [--runs N] [--json]\n`)
    process.exit(1)
  }

  const argv    = process.argv.slice(2)
  const target  = argv.find(a => !a.startsWith('--'))
  const asJson  = argv.includes('--json')
  const runsArg = argv.indexOf('--runs')
  const runs    = runsArg >= 0 ? Number.parseInt(argv[runsArg + 1] ?? '2', 10) : 2

  if (!target || !Number.isFinite(runs) || runs < 1)
    usage()

  const path = target.endsWith('.json') ? resolve(target) : resolve(scenariosDir, `${target}.json`)

  let script: Script
  try {
    script = JSON.parse(await readFile(path, 'utf8')) as Script
  }
  catch {
    process.stderr.write(`no such scenario: ${path}\n`)
    process.exit(1)
  }

  const results: Summary[] = []

  for (let i = 0; i < runs; i++)
    results.push(await run(script))

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
      ...extraFields(first),
    }, null, 2)}\n`)
  }

  if (!deterministic) {
    process.stderr.write(
      '\nDETERMINISM BROKEN: two runs of the same script diverged.\n' +
      'Per AGENTS.md this is a real bug and comes before anything else.\n'
    )
    process.exit(1)
  }
}
