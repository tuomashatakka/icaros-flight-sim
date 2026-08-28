import * as THREE from 'three'
import { createApp, defineModule } from 'threejs-scene'
import { standardLighting } from 'threejs-scene/modules/lighting'
import { orbitControls } from 'threejs-scene/modules/orbit'
import type { App, AppModule } from 'threejs-scene'
import { loadShip } from '../assets/ship-loader'
import type { ShipInstance } from '../assets/ship-loader'
import {
  FORCE_COLOURS,
  FORCE_SCALE,
  MAX_ARROW,
  NET_FORCE_COLOUR,
  NET_TORQUE_COLOUR,
  TORQUE_SCALE,
  createVectorLines,
} from '../fx/vectors'
import { CRASH_CASES, LANE_PITCH } from '@crash-velocity/physics/lab/cases'
import type { CrashCase, LabSolid, LabTrace } from '@crash-velocity/physics/lab/cases'
import { runCrashCase } from '@crash-velocity/physics/lab/run'
import { DEFAULT_CONFIGS } from '@/lib/ship/registry'

/**
 * The crash lab, as something you can watch.
 *
 * It does NOT simulate. Every lane is played back from the trace the headless
 * runner already produced, which buys three things at once: scrubbing is exact,
 * stepping BACKWARDS is possible at all, and the arrows you pause on are
 * literally the forces the assertions ran against. A live re-simulation could
 * only ever be a second opinion about what the tests saw.
 *
 * Lane geometry is built from the same `LabSolid` list the physics consumed, the
 * way `arena.ts` builds its ramps from `plateauColliders` — a lane's mesh cannot
 * drift from the lane's collision because there is one list.
 */

export type CrashLabState = {
  frame:     number;
  playing:   boolean;
  showPath:  boolean;
  showWire:  boolean;
  showForce: boolean;
}

export type LaneReport = {
  id:     string;
  title:  string;
  lane:   number;
  frames: number;
  hash:   string;
  checks: Array<{ label: string; ok: boolean }>;
}

export type CrashLabHandle = {
  totalFrames: number;
  lanes:       LaneReport[];

  /** World-space X of a lane centre, for the camera. */
  laneX (lane: number): number;
}

const SHIP_SIZE   = 2.8

/** Centre of the whole rig, so the camera and the orbit target agree. */
const CENTRE_X = (CRASH_CASES.length - 1) * LANE_PITCH / 2

/**
 * A beacon above each dummy.
 *
 * Eight lanes span nearly two kilometres and a ship is under three metres, so at
 * the framing that shows every lane at once the hulls are sub-pixel. The beacon
 * is what you track from the overview; zoom in and the hull and its force arrows
 * are underneath it.
 */
const BEACON_HEIGHT = 26
const VISUAL_LIFT   = 0.5

const _pos   = new THREE.Vector3()
const _vec   = new THREE.Vector3()
const _quat  = new THREE.Quaternion()
const _euler = new THREE.Euler()

let camera: THREE.Camera = new THREE.PerspectiveCamera()

/** A lane's static geometry, as meshes built from its collider list. */
function buildSolids (parent: THREE.Object3D, solids: readonly LabSolid[], wire: THREE.Material) {
  const meshes: THREE.Mesh[] = []
  for (const solid of solids) {
    const geometry = new THREE.BoxGeometry(solid.half[0] * 2, solid.half[1] * 2, solid.half[2] * 2)
    const material = new THREE.MeshStandardMaterial({
      color:     solid.colour ?? '#1a1e2c',
      metalness: 0.1,
      roughness: 0.9,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(solid.position[0], solid.position[1], solid.position[2])
    mesh.rotation.set(solid.rotation[0], solid.rotation[1], solid.rotation[2])
    mesh.receiveShadow = true
    parent.add(mesh)
    meshes.push(mesh)

    // A second pass in wireframe, toggled by the transport bar. Sharing the
    // geometry means the outline cannot disagree with the solid it outlines.
    const outline = new THREE.Mesh(geometry, wire)
    outline.position.copy(mesh.position)
    outline.rotation.copy(mesh.rotation)
    outline.visible = false
    outline.name    = 'wire'
    parent.add(outline)
  }
  return meshes
}

type Lane = {
  crash:    CrashCase;
  trace:    LabTrace;
  root:     THREE.Group;
  shipRoot: THREE.Group;
  props:    THREE.Mesh[];
  path:     THREE.Line;
  wires:    THREE.Object3D[];
}

/** `?lane=3` frames that lane instead of the whole rig. */
function requestedLane (): number | null {
  if (typeof window === 'undefined')
    return null

  const raw = new URLSearchParams(window.location.search).get('lane')
  if (raw === null)
    return null

  const lane = Number(raw)
  return Number.isInteger(lane) && lane >= 0 && lane < CRASH_CASES.length ? lane : null
}

export async function mountCrashLab (
  canvas: HTMLCanvasElement,
  onReady: (handle: CrashLabHandle) => void = () => {}
): Promise<App<CrashLabState>> {
  // Run every case up front. Eight worlds of ~1000 ticks costs a few hundred
  // milliseconds headless, which is cheaper than the ship models that follow.
  const traces: LabTrace[] = []
  for (const crash of CRASH_CASES)
    traces.push(await runCrashCase(crash))

  const totalFrames   = Math.max(...traces.map(t => t.frames.length))
  const lanes: Lane[] = []

  const wireMaterial = new THREE.MeshBasicMaterial({
    color:       '#22d3ee',
    wireframe:   true,
    transparent: true,
    opacity:     0.28,
  })

  // Close enough that a hull is a hull and its arrows are legible; the overview
  // is nearly two kilometres wide and everything on a ship is under three metres.
  const focusLane                     = requestedLane()
  const focusX                        = focusLane === null ? CENTRE_X : focusLane * LANE_PITCH
  const eye: [number, number, number] = focusLane === null
    ? [ CENTRE_X, 760, 900 ]
    : [ focusX, 34, 72 ]

  const forceLines = createVectorLines(8192)
  const netLines   = createVectorLines(1024)

  // The single loaded hull every lane shares. Held here so teardown can free it
  // exactly once, however many lanes cloned it.
  let hull: ShipInstance | null = null

  const app = createApp<CrashLabState>(canvas, {
    state: {
      frame:     0,
      playing:   true,
      showPath:  true,
      showWire:  false,
      showForce: true,
    },
    seed:     17,
    camera:   { position: eye, lookAt: [ focusX, 0, 0 ], fov: 55, far: 12000 },
    scene:    { background: '#080a12' },
    renderer: { shadows: true },
    use:      [
      standardLighting<CrashLabState>({
        env:  { intensity: 0.3 },
        sun:  { intensity: 1.1 },
        hemi: { skyColor: '#8a9bff', groundColor: '#0a0c14', intensity: 0.45 },
      }) as unknown as AppModule<CrashLabState>,

      // The overview orbits; a focused lane FOLLOWS its dummy instead. Orbiting
      // a fixed point is useless when the thing you came to look at is doing
      // 50 m/s down a 600 m deck, and the two cannot both drive the camera.
      ...focusLane === null
        ? [ orbitControls<CrashLabState>({ radius: [ 8, 6000 ], target: [ focusX, 0, 0 ]}) ]
        : [],

      defineModule<CrashLabState>({
        name: 'crash-lab',

        build (ctx) {
          camera = ctx.camera
          ctx.scene.fog = new THREE.Fog('#080a12', 2200, 6000)
          ctx.scene.add(forceLines.object, netLines.object)

          CRASH_CASES.forEach((crash, i) => {
            const trace     = traces[i]
            const root      = new THREE.Group()
            root.name       = `lane.${crash.id}`
            root.position.x = crash.lane * LANE_PITCH
            ctx.scene.add(root)

            buildSolids(root, crash.solids, wireMaterial)

            // The recorded ground path. This is the "expected track": the route
            // the assertions were run against, not an idealised one.
            const path = new THREE.Line(
              new THREE.BufferGeometry().setAttribute(
                'position',
                new THREE.BufferAttribute(
                  new Float32Array(trace.frames.flatMap(f => [ f.pos[0], f.pos[1] + 0.35, f.pos[2] ])),
                  3
                )
              ),
              new THREE.LineBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.55 })
            )
            path.frustumCulled = false
            root.add(path)

            const props = (crash.props ?? []).map(prop => {
              const mesh = new THREE.Mesh(
                new THREE.BoxGeometry(prop.half[0] * 2, prop.half[1] * 2, prop.half[2] * 2),
                new THREE.MeshStandardMaterial({ color: prop.colour ?? '#f7b267', roughness: 0.7 })
              )
              mesh.castShadow = true
              root.add(mesh)
              return mesh
            })

            const beacon = new THREE.Line(
              new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(0, 0, 0),
                new THREE.Vector3(0, BEACON_HEIGHT, 0),
              ]),
              new THREE.LineBasicMaterial({ color: '#22d3ee', transparent: true, opacity: 0.5 })
            )
            beacon.frustumCulled = false

            const shipRoot = new THREE.Group()
            shipRoot.add(beacon)
            root.add(shipRoot)

            const lane: Lane = {
              crash,
              trace,
              root,
              shipRoot,
              props,
              path,
              wires: root.children.filter(c => c.name === 'wire'),
            }
            lanes.push(lane)
          })

          // ONE hull, eight lanes.
          //
          // Every lane flies the same ship at the same size, so this used to
          // call `loadShip` eight times: eight procedural builds, eight sets of
          // geometry, materials and shader programs, all resolving in the same
          // moment. Cloning shares geometry and materials, which is both what
          // the lab wants — every dummy IS the same ship — and eight times less
          // to allocate in the one window where a memory-pressured phone was
          // dropping the WebGL context out from under the scene.
          //
          // Async, so the lab is watchable immediately and the hulls appear as
          // they resolve.
          void loadShip(DEFAULT_CONFIGS.icaras.shipId, SHIP_SIZE).then(instance => {
            hull = instance

            lanes.forEach((lane, index) => {
              // The original goes to the first lane; the rest get clones of it,
              // so nothing is built twice and nothing is left unused.
              const root      = index === 0 ? instance.root : instance.root.clone(true)
              root.position.y = VISUAL_LIFT
              lane.shipRoot.add(root)
            })
          })

          const handle: CrashLabHandle = {
            totalFrames,
            laneX: lane => lane * LANE_PITCH,
            lanes: CRASH_CASES.map((crash, i) => ({
              id:     crash.id,
              title:  crash.title,
              lane:   crash.lane,
              frames: traces[i].frames.length,
              hash:   traces[i].hash,
              checks: crash.checks.map(c => ({ label: c.label, ok: c.run(traces[i]) })),
            })),
          }
          onReady(handle)

          // A readiness flag for `dev-cli --level crash-lab`. Dev-only: the lab
          // is a shipped route now, but the CLI hook behind it is not.
          if (process.env.NODE_ENV !== 'production')
            (window as unknown as { __crashLab?: unknown }).__crashLab = {
              ready: true,
              ...handle,

              /** Freeze on one frame, so `dev:shot --step N` is reproducible. */
              setFrame (frame: number) {
                app.setState({ frame: Math.max(0, Math.min(totalFrames - 1, frame)), playing: false })
              },
            }
        },

        update (state) {
          forceLines.begin()
          netLines.begin()

          for (const lane of lanes) {
            // Lanes are different lengths; a short one holds its last pose
            // rather than vanishing, so the scrubber stays readable throughout.
            const index = Math.min(state.frame, lane.trace.frames.length - 1)
            const frame = lane.trace.frames[index]
            const offX  = lane.crash.lane * LANE_PITCH

            lane.shipRoot.position.set(frame.pos[0], frame.pos[1], frame.pos[2])
            // Poses are recorded, so orientation comes back off the velocity
            // basis the trace carries rather than a stored quaternion.
            _euler.set(frame.pitch, Math.atan2(frame.linvel[0], frame.linvel[2]), -frame.roll, 'YXZ')
            lane.shipRoot.quaternion.setFromEuler(_euler)

            lane.path.visible = state.showPath
            for (const wire of lane.wires)
              wire.visible = state.showWire

            const props = lane.trace.props[index]
            lane.props.forEach((mesh, i) => {
              const p = props?.[i]
              if (p)
                mesh.position.set(p[0], p[1], p[2])
            })

            if (!state.showForce)
              continue

            for (const force of frame.forces) {
              _pos.set(force.point[0] + offX, force.point[1], force.point[2])
              _vec.set(force.vector[0], force.vector[1], force.vector[2]).multiplyScalar(FORCE_SCALE)
              if (_vec.length() > MAX_ARROW)
                _vec.setLength(MAX_ARROW)
              forceLines.arrow(_pos, _vec, FORCE_COLOURS[force.group] ?? 0xffffff)
            }

            _pos.set(frame.pos[0] + offX, frame.pos[1], frame.pos[2])
            _vec.set(frame.netForce[0], frame.netForce[1], frame.netForce[2]).multiplyScalar(FORCE_SCALE)
            if (_vec.length() > MAX_ARROW)
              _vec.setLength(MAX_ARROW)
            netLines.arrow(_pos, _vec, NET_FORCE_COLOUR)

            _vec.set(frame.netTorque[0], frame.netTorque[1], frame.netTorque[2]).multiplyScalar(TORQUE_SCALE)
            if (_vec.length() > MAX_ARROW)
              _vec.setLength(MAX_ARROW)
            netLines.arrow(_pos, _vec, NET_TORQUE_COLOUR)
          }

          forceLines.end()
          netLines.end()

          if (focusLane !== null) {
            const followed = lanes.find(l => l.crash.lane === focusLane)
            if (followed) {
              const index = Math.min(state.frame, followed.trace.frames.length - 1)
              const frame = followed.trace.frames[index]
              _pos.set(frame.pos[0] + focusLane * LANE_PITCH, frame.pos[1], frame.pos[2])
              camera.position.set(_pos.x + 13, _pos.y + 9, _pos.z - 20)
              camera.lookAt(_pos)
            }
          }
        },

        dispose () {
          forceLines.dispose()
          netLines.dispose()
          wireMaterial.dispose()
          // Disposed once, not once per lane: the other seven are clones that
          // share this instance's geometry and materials, and disposing those
          // a second time would free buffers still referenced by the first.
          hull?.dispose()
          hull = null
          lanes.length = 0
        },
      }),
    ],
  })

  // Playback lives here rather than in React: advancing a frame index at 60 Hz
  // through `useState` is sixty commits a second for a number only the scene
  // reads. The transport bar writes intent (play/pause/seek); this owns time.
  let carry = 0
  app.ctx.loop.onFrame(({ delta }) => {
    const state = app.getState()
    if (!state.playing)
      return
    carry += delta * 60

    const step = Math.floor(carry)
    if (step < 1)
      return
    carry -= step
    app.setState({ frame: (state.frame + step) % totalFrames })
  })

  _quat.identity()
  return app
}
