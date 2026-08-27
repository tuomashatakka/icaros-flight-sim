#!/usr/bin/env node
/**
 * Drive the running game from a shell.
 *
 * This exists because the alternative — an agent taking screenshots of a 3D
 * scene through an MCP browser and guessing — is slow, expensive, and imprecise.
 * Every command here boots the app, talks to `window.__dev`, and prints compact
 * JSON. One shell call in, ~15 lines out.
 *
 * The governing rule is OUTPUT SIZE. Defaults are summaries; full traces go to
 * files and only the path is printed. A 700-sample trace should never enter a
 * context window unless somebody explicitly asked for it.
 *
 *   node scripts/dev-cli.mjs probe --level flats
 *   node scripts/dev-cli.mjs scenario hard-corner
 *   node scripts/dev-cli.mjs scenario hard-corner --json --out /tmp/trace.json
 *   node scripts/dev-cli.mjs shot /tmp/a.png --step 300 --overlay colliders,wheels
 *   node scripts/dev-cli.mjs console --seconds 5
 *   node scripts/dev-cli.mjs eval -e '__dev.probe().ship.position'
 */
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'


const ROOT      = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT      = Number(process.env.DEV_PORT ?? 9002)
const ORIGIN    = `http://localhost:${PORT}`
const SCENARIOS = resolve(ROOT, 'public/scenarios')

/** How long to wait for `__dev.ready`. Rapier WASM + FBX loading is not instant. */
const READY_TIMEOUT = 60_000

/** How long to wait for a dev server we spawned ourselves. */
const SERVER_TIMEOUT = 90_000

/**
 * The battle server's port and how long to wait for it.
 *
 * Battle mode is network-only, so `--level battle` needs a second process. It
 * starts far faster than `next dev` — no bundler, just a bun entry point — so
 * the timeout is a fraction of the client's.
 */
const BATTLE_PORT    = Number(process.env.BATTLE_PORT ?? 9003)
const BATTLE_ORIGIN  = `http://localhost:${BATTLE_PORT}`
const BATTLE_TIMEOUT = 15_000

// ---------------------------------------------------------------- argv

function parseArgs (argv) {
  const args = { _: []}
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token.startsWith('--')) {
      const key  = token.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--'))
        args[key] = true
      else {
        args[key] = next
        i++
      }
    }
    else if (token === '-e')
      args.e = argv[++i]
    else
      args._.push(token)
  }
  return args
}

const out = value => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)

function fail (message, code = 1) {
  process.stderr.write(`${message}\n`)
  process.exit(code)
}

// ---------------------------------------------------------------- server

async function serverIsUp () {
  try {
    const response = await fetch(ORIGIN, { signal: AbortSignal.timeout(1500) })
    return response.ok || response.status < 500
  }
  catch {
    return false
  }
}

/**
 * Reuse the user's dev server when one is already listening.
 *
 * Deliberate: a `next dev` cold start costs ~15 s and recompiles routes on first
 * hit, which would dominate every single command. Reusing the running server
 * also means what the CLI sees is what the human sees in their browser.
 */
async function battleServerIsUp () {
  try {
    const response = await fetch(`${BATTLE_ORIGIN}/health`, { signal: AbortSignal.timeout(1000) })
    return response.ok
  }
  catch {
    return false
  }
}

/**
 * Bring up the battle server for `--level battle`, reusing one already running.
 *
 * `DEV_COMMANDS=1` is what makes `window.__devBattle.place()` and `.face()`
 * work: they are server requests now, and the server ignores them without it.
 */
async function ensureBattleServer () {
  if (await battleServerIsUp())
    return { spawned: false, stop: async () => {} }

  process.stderr.write(`[dev-cli] no battle server on ${BATTLE_ORIGIN}, starting one…\n`)

  const child = spawn('bun', [ 'run', 'dev:server' ], {
    cwd:   ROOT,
    stdio: 'ignore',
    env:   { ...process.env, DEV_COMMANDS: '1' },
  })

  const deadline = Date.now() + BATTLE_TIMEOUT
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 250))
    if (await battleServerIsUp())
      return {
        spawned: true,
        stop:    async () => {
          child.kill('SIGTERM')
        },
      }
  }

  child.kill('SIGTERM')
  fail(`battle server did not come up on ${BATTLE_ORIGIN} within ${BATTLE_TIMEOUT / 1000}s`)
}

async function ensureServer () {
  if (await serverIsUp())
    return { spawned: false, stop: async () => {} }

  process.stderr.write(`[dev-cli] no server on ${ORIGIN}, starting one…\n`)

  const child = spawn('bun', [ 'run', 'dev' ], { cwd: ROOT, stdio: 'ignore', detached: false })

  const deadline = Date.now() + SERVER_TIMEOUT
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 800))
    if (await serverIsUp())
      return {
        spawned: true,
        stop:    async () => {
          child.kill('SIGTERM')
        },
      }
  }

  child.kill('SIGKILL')
  throw new Error(`dev server did not come up on ${ORIGIN} within ${SERVER_TIMEOUT / 1000}s`)
}

// ---------------------------------------------------------------- browser

function buildUrl (args, extra = {}) {
  const level = args.level ?? 'flats'
  const query = new URLSearchParams()
  if (args.seed)
    query.set('seed', String(args.seed))
  if (args.overlay)
    query.set('overlay', String(args.overlay))
  if (args.nohud)
    query.set('nohud', '1')
  // Generic passthrough for the dev-only URL overrides the app reads directly
  // (`?touch=1`, `?post=low`, `?tuning=`), so the CLI does not need a flag per
  // knob. `--query a=1,b=2`.
  if (args.query)
    for (const pair of String(args.query).split(','))
      if (pair.includes('=')) {
        const [ key, value ] = pair.split('=')
        query.set(key, value)
      }
  for (const [ key, value ] of Object.entries(extra))
    query.set(key, String(value))

  const search = query.toString()
  // `--level battle` targets the arena route, which is not under /levels.
  const path   = level === 'battle' ? '/battle' : `/levels/${level}`
  return `${ORIGIN}${path}${search ? `?${search}` : ''}`
}

/**
 * Boot a page with the harness live, run `fn(page)`, tear everything down.
 *
 * SwiftShader is forced on: headless Chromium has no GPU here, and without a
 * software rasteriser the WebGL context creation fails and the scene never
 * mounts — which surfaces as an unhelpful `__dev.ready` timeout.
 */
async function withPage (args, fn, { urlExtra = {}} = {}) {
  const server = await ensureServer()

  // Battle is network-only: without the authoritative server the scene mounts
  // an empty arena and `__dev.ready` never sees a match.
  const battle = args.level === 'battle'
    ? await ensureBattleServer()
    : { spawned: false, stop: async () => {} }

  // Sandboxes and CI images often ship a chromium that does not match the build
  // playwright pinned; point at it with CHROMIUM_PATH rather than re-downloading
  // half a gigabyte on every run.
  const executablePath = process.env.CHROMIUM_PATH || undefined
  const browser        = await chromium.launch({
    headless: args.headed ? false : true,
    executablePath,
    args:     [
      '--enable-unsafe-swiftshader',
      '--use-angle=swiftshader',
      '--use-gl=angle',
      '--disable-dev-shm-usage',
    ],
  })

  const [ width, height ] = String(args.size ?? '1280x720').split('x')
    .map(Number)
  const page = await browser.newPage({ viewport: { width, height }})

  const consoleLines = []
  page.on('console', message => consoleLines.push(`[${message.type()}] ${message.text()}`))
  page.on('pageerror', error => consoleLines.push(`[pageerror] ${error.message}`))

  try {
    await page.goto(buildUrl(args, urlExtra), { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => window.__dev?.ready === true, null, { timeout: READY_TIMEOUT })
      .catch(async () => {
        // A ready timeout is nearly always a mount failure, and the console is
        // where the reason is. Surfacing it here saves an entire second run.
        throw new Error(
          `__dev never became ready.\nConsole:\n${consoleLines.slice(-25).join('\n') || '(empty)'}`
        )
      })
    return await fn(page, { consoleLines })
  }
  finally {
    await browser.close()
    await server.stop()
    await battle.stop()
  }
}

// ---------------------------------------------------------------- scenarios

async function loadScenario (nameOrPath) {
  const candidates = nameOrPath.endsWith('.json')
    ? [ resolve(process.cwd(), nameOrPath), resolve(ROOT, nameOrPath) ]
    : [ resolve(SCENARIOS, `${nameOrPath}.json`) ]

  for (const candidate of candidates)
    try {
      return JSON.parse(await readFile(candidate, 'utf8'))
    }
    catch (cause) {
      if (cause.code !== 'ENOENT')
        throw new Error(`${candidate}: ${cause.message}`)
    }
  throw new Error(`scenario not found: ${nameOrPath} (looked in ${SCENARIOS})`)
}

// ---------------------------------------------------------------- commands

const commands = {
  async probe (args) {
    const result = await withPage(args, page => page.evaluate(() => window.__dev.probe()))
    out(result)
  },

  async scenario (args) {
    const name = args._[0]
    if (!name)
      fail('usage: dev-cli scenario <name|path.json> [--json] [--out FILE]')

    const script = await loadScenario(name)
    const level  = args.level ?? script.level ?? 'flats'

    const trace = await withPage({ ...args, level }, page =>
      page.evaluate(s => window.__dev.scenario(s), script))

    if (args.out) {
      await mkdir(dirname(resolve(args.out)), { recursive: true })
      await writeFile(resolve(args.out), JSON.stringify(trace, null, 2))
      process.stderr.write(`[dev-cli] full trace -> ${resolve(args.out)}\n`)
    }

    // Default to the summary. The full trace is available but never the default,
    // because printing 120 sample rows is the exact cost this tool exists to avoid.
    out(args.json
      ? trace
      : {
        name:    trace.name,
        level:   trace.level,
        seed:    trace.seed,
        ticks:   trace.ticks,
        wallMs:  trace.wallMs,
        samples: trace.samples.length,
        summary: trace.summary,
        events:  trace.events,
      })
  },

  async shot (args) {
    const target = args._[0]
    if (!target)
      fail('usage: dev-cli shot <out.png> [--step N] [--at x,y,z[,yaw]] [--overlay a,b] [--size WxH] [--query k=v]')

    const path = resolve(target)
    await mkdir(dirname(path), { recursive: true })

    const probe = await withPage(args, async page => {
      // Freeze first, then advance a known number of ticks. Two runs of the same
      // command land on the same tick with the same seed, so the images are
      // comparable — an unpaused screenshot is at the mercy of frame timing.
      await page.evaluate(() => window.__dev.pause())

      // `--at x,y,z[,yaw]` frames a specific part of the level without having to
      // drive there, which on a 600-unit deck is most of the run time.
      if (args.at) {
        const [ x, y, z, yaw ] = String(args.at).split(',')
          .map(Number)
        await page.evaluate(
          place => window.__dev.teleport({ position: [ place.x, place.y, place.z ], yaw: place.yaw }),
          { x, y, z, yaw: Number.isFinite(yaw) ? yaw : 0 }
        )
      }

      const steps  = Number(args.step ?? 0)
      const result = steps > 0
        ? await page.evaluate(n => window.__dev.step(n), steps)
        : await page.evaluate(() => window.__dev.probe())
      // The sim is deterministic; the camera's real-time damping is not. Without
      // this the same command produces visibly different framing each run.
      await page.evaluate(() => window.__dev.snapCamera())
      // `animations: 'disabled'` is not cosmetic. The battle HUD carries several
      // `infinite` CSS animations (a contested zone flashes, low health pulses),
      // and a plain screenshot waits for them to settle — which they never do,
      // so the call just times out once a match goes live. Cancelling them also
      // makes the capture deterministic, which is the whole point of pausing
      // and snapping the camera above.
      await page.screenshot({ path, animations: 'disabled' })
      return result
    }, { urlExtra: args.nohud ? {} : {}})

    out({ path, tick: probe.sim.tick, ship: probe.ship, overlay: probe.overlay })
  },

  async console (args) {
    const seconds = Number(args.seconds ?? 5)
    const result  = await withPage(args, async (page, { consoleLines }) => {
      // Drive a little: a scene that only ever idles will not hit the code paths
      // where the interesting errors live.
      await page.evaluate(() => window.__dev.setInput({ throttle: true }))
      await page.waitForTimeout(seconds * 1000)

      const trace = await page.evaluate(() => window.__dev.trace())
      return { trace, consoleLines }
    })

    out({
      errorCount:  result.trace.errorCount,
      contextLost: result.trace.contextLost,
      frameMs:     result.trace.frameMs,
      fps:         result.trace.fps,
      drawCalls:   result.trace.drawCalls,
      errors:      result.trace.errors,
      console:     result.consoleLines.slice(-30),
    })
  },

  async eval (args) {
    const expression = args.e ?? args._[0]
    if (!expression)
      fail("usage: dev-cli eval -e '<javascript>'")

    const result = await withPage(args, page =>

      page.evaluate(source => new Function(`return (${source})`)(), expression))
    out(result)
  },
}

// ---------------------------------------------------------------- main

const [ , , command, ...rest ] = process.argv
if (!command || !commands[command])
  fail(`usage: dev-cli <${Object.keys(commands).join('|')}> [options]\n\n${
    'See the header of scripts/dev-cli.mjs for examples.'}`)

commands[command](parseArgs(rest)).catch(cause => {
  fail(`[dev-cli] ${cause.message}`)
})
