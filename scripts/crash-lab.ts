/**
 * Crash-dummy CLI.
 *
 *   bun run lab                    every case, pass/fail per check
 *   bun run lab wall-slam          one case
 *   bun run lab --dump             also write full traces to data/crash-lab/
 *   bun run lab --twice            run everything twice and compare hashes
 *
 * The dumped trace is every tick of every case — pose, velocities, per-thruster
 * throttle, net force and torque, contacts, air-brake state — which is what you
 * read when a check fails and the summary line does not explain why.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { CRASH_CASES } from 'Δengine/sim/lab/cases'
import { runCrashCase } from 'Δengine/sim/lab/run'


const ESC   = String.fromCharCode(27)
const bold  = (s: string) => `${ESC}[1m${s}${ESC}[0m`
const dim   = (s: string) => `${ESC}[2m${s}${ESC}[0m`
const green = (s: string) => `${ESC}[32m${s}${ESC}[0m`
const red   = (s: string) => `${ESC}[31m${s}${ESC}[0m`

const args   = process.argv.slice(2)
const dump   = args.includes('--dump')
const twice  = args.includes('--twice')
const wanted = args.filter(a => !a.startsWith('--'))
const cases  = wanted.length ? CRASH_CASES.filter(c => wanted.includes(c.id)) : CRASH_CASES

if (!cases.length) {
  console.error(`no such case. known: ${CRASH_CASES.map(c => c.id).join(', ')}`)
  process.exit(1)
}

let failed = 0

for (const crash of cases) {
  const trace = await runCrashCase(crash)
  const last  = trace.frames[trace.frames.length - 1]

  console.log(`\n${bold(crash.id)}  ${dim(crash.title)}`)
  console.log(`  ${trace.frames.length} ticks  hash ${trace.hash}` +
    `  end ${last.pos.map(n => n.toFixed(1)).join(', ')}` +
    `  fwd ${last.fwdSpeed.toFixed(2)}  up ${last.up.toFixed(3)}`)

  if (twice) {
    const again = await runCrashCase(crash)
    const same  = again.hash === trace.hash
    if (!same)
      failed++
    console.log(`  ${same ? green('PASS') : red('FAIL')}  deterministic (${trace.hash} vs ${again.hash})`)
  }

  for (const check of crash.checks) {
    const ok = check.run(trace)
    if (!ok)
      failed++
    console.log(`  ${ok ? green('PASS') : red('FAIL')}  ${check.label}`)
  }

  if (dump) {
    await mkdir('data/crash-lab', { recursive: true })
    await writeFile(`data/crash-lab/${crash.id}.json`, JSON.stringify(trace))
    console.log(dim(`  wrote data/crash-lab/${crash.id}.json`))
  }
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nall crash dummies passed')
process.exit(failed ? 1 : 0)
