/**
 * Run the whole game: the Next client and the battle server, together.
 *
 * Battle mode is network-only, so `bun run dev` on its own gets you a lobby
 * screen that never connects. This starts both, prefixes their output so it is
 * obvious which process said what, and takes both down together — a stray
 * server holding port 9003 is the confusing failure this avoids.
 *
 * Zero dependencies on purpose. A process runner would be one more thing in a
 * repo that deliberately has very few.
 */
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'


const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const targets = [
  { name: 'client', color: '\x1b[36m', args: [ 'run', 'dev' ]},
  { name: 'server', color: '\x1b[35m', args: [ 'run', 'dev:server' ]},
]

const children = []
let stopping   = false

function prefix (target, chunk) {
  const reset = '\x1b[0m'
  for (const line of String(chunk).split('\n'))
    if (line.trim())
      process.stdout.write(`${target.color}[${target.name}]${reset} ${line}\n`)
}

for (const target of targets) {
  const child = spawn('bun', target.args, { cwd: ROOT, stdio: [ 'ignore', 'pipe', 'pipe' ]})

  child.stdout.on('data', chunk => prefix(target, chunk))
  child.stderr.on('data', chunk => prefix(target, chunk))

  child.on('exit', code => {
    if (stopping)
      return
    // One half exiting makes the other useless, so the pair lives and dies
    // together rather than leaving a half-running session behind.
    process.stderr.write(`\n[dev-all] ${target.name} exited (${code}), stopping the rest\n`)
    stop(code ?? 1)
  })

  children.push(child)
}

function stop (code) {
  if (stopping)
    return
  stopping = true
  for (const child of children)
    child.kill('SIGTERM')
  setTimeout(() => process.exit(code), 300)
}

process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))

process.stdout.write('[dev-all] client on :9002 · battle server on :9003\n')
