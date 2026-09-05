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
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'


const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The two halves must agree on which database they are looking at.
 *
 * Next mints session tokens and the battle server reads them, so if they
 * resolve different stores every sign-in still succeeds and every lobby
 * connection still lands as a guest — a failure with no error in it anywhere.
 * Next loads `.env.local` itself; this reads the same file and forwards the two
 * variables that matter, rather than trusting both runtimes to do it the same
 * way.
 */
function envLocal () {
  let text
  try {
    text = readFileSync(resolve(ROOT, '.env.local'), 'utf8')
  }
  catch {
    return {}
  }

  const found = {}
  for (const line of text.split('\n')) {
    const match = (/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/).exec(line)
    if (match)
      found[match[1]] = match[2].trim().replace(/^["']|["']$/g, '')
  }
  return found
}

const local = envLocal()
const env   = {
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL ?? local.DATABASE_URL,
  STORE_DRIVER: process.env.STORE_DRIVER ?? local.STORE_DRIVER,
}

for (const key of [ 'DATABASE_URL', 'STORE_DRIVER' ])
  if (env[key] === undefined)
    delete env[key]

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
  const child = spawn('bun', target.args, { cwd: ROOT, env, stdio: [ 'ignore', 'pipe', 'pipe' ]})

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

if (!env.DATABASE_URL && env.STORE_DRIVER !== 'memory')
  // Not a warning about something broken — everything below sign-in works fine
  // offline. It is about the one thing that cannot: `next dev` runs on node, so
  // its route handlers cannot open the server's sqlite file, and the two halves
  // end up with separate stores.
  process.stdout.write(
    '[dev-all] no DATABASE_URL: the game is fully playable as a guest, but signing in ' +
    'needs both halves on one database. Point DATABASE_URL at a Neon branch in .env.local.\n'
  )
