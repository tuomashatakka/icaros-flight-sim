import * as THREE from 'three'
import type { SceneContext } from 'threejs-scene'
import type { BoxCollider } from '@/lib/track/build-track'


export type BattleTeam = 'red' | 'blue'

export const BATTLE_TEAMS: BattleTeam[] = [ 'red', 'blue' ]

export function otherTeam (team: BattleTeam): BattleTeam {
  return team === 'red' ? 'blue' : 'red'
}

/** The teams' accent colours, shared by the arena visuals and the HUD. */
export const TEAM_COLORS: Record<BattleTeam, string> = {
  red:  '#ff2d6f',
  blue: '#22d3ee',
}

/** Neutral sign displayed while a control point is unowned. */
export const NEUTRAL_COLOR = '#b7f34a'

export type ArenaTransform = {
  position:   [number, number, number];
  quaternion: [number, number, number, number];
}

export type ControlPointDef = {
  id:       string;
  name:     string;
  position: [number, number, number];
  radius:   number;
}

/**
 * A battle arena, as data.
 *
 * Deliberately NOT the race `LevelSpec` (which carries waypoints/laps): battle
 * is objective-based, so the arena describes bases, control zones and spawn
 * points instead. Colliders stay box strips for the raycast wheels. The module
 * is Node-safe — `SceneContext` is type-only, so the headless server can import
 * the collider/shape data without dragging in the renderer.
 */
export type BattleArena = {
  id:         string;
  name:       string;
  tagline:    string;
  background: string;
  fog:        [string, number, number];
  bloom:      { strength: number; threshold: number; radius: number };

  /** Deck height. Vehicles hover above this. */
  floorY: number;

  colliders:      BoxCollider[];
  colliderOffset: [number, number, number];

  /** Base positions + where each team's flag rests when home. */
  bases: Record<BattleTeam, {
    position: [number, number, number];
    flagRest: [number, number, number];
  }>;

  /** Vehicle entry points — explore these out, not into the enemy side. */
  spawns: Record<BattleTeam, ArenaTransform[]>;

  controlPoints: ControlPointDef[];

  // --- rule timings, in SIM seconds ---
  captureTime:    number; // seconds inside uncontested to flip a zone
  decayTime:      number; // seconds unattended to fully decay to neutral
  zonePeriod:     number; // seconds of ownership per +1 score tick
  flagReturnTime: number; // seconds a dropped flag waits before returning home

  buildVisual(ctx: SceneContext): void;
}

const HALF                          = 100 // deck half-extent
const WALL                          = 92 // perimeter wall distance from origin
const FOG: [string, number, number] = [ '#0a0c14', 120, 400 ]

/** Deck half-extent, exported so the client scene can size its own floor to match. */
export const ARENA_HALF = HALF

const spawn = (x: number, z: number, yawPi: boolean): ArenaTransform => ({ position: [ x, 0, z ], quaternion: yawPi ? [ 0, 1, 0, 0 ] : [ 0, 0, 0, 1 ]})

const RED_SPAWN    = spawn(0, -55, false)
const BLUE_SPAWN   = spawn(0, 55, true)
const RED_SPAWN_L  = spawn(-24, -57, false)
const BLUE_SPAWN_L = spawn(-24, 57, true)
const RED_SPAWN_R  = spawn(24, -57, false)
const BLUE_SPAWN_R = spawn(24, 57, true)

/**
 * Apex Basin — a symmetric CTF/domination arena on a flat deck.
 *
 * Teams line up along Z: red defends z < 0, blue z > 0. Three control zones
 * sit on the centreline (one near each base, one contested mid-field), and
 * four box cover blocks break up the midfield lanes. Every shape is box strips
 * for the raycast wheels; nothing here is a trimesh.
 */
export function apexArena (): BattleArena {
  const ground: BoxCollider[] = [
    {
      position: [ 0, -0.5, 0 ],
      rotation: [ 0, 0, 0 ],
      args:     [ HALF, 0.5, HALF ]
    },
    {
      position: [ 0, 3, WALL ],
      rotation: [ 0, 0, 0 ],
      args:     [ WALL, 3, 1 ]
    },
    {
      position: [ 0, 3, -WALL ],
      rotation: [ 0, 0, 0 ],
      args:     [ WALL, 3, 1 ]
    },
    {
      position: [ WALL, 3, 0 ],
      rotation: [ 0, 0, 0 ],
      args:     [ 1, 3, WALL ]
    },
    {
      position: [ -WALL, 3, 0 ],
      rotation: [ 0, 0, 0 ],
      args:     [ 1, 3, WALL ]
    },
  ]

  // Midfield cover — symmetric so neither team gets a home-side block dump.
  const cover: BoxCollider[] = ((x: number, z: number) => [
    { position: [ x, 2, z ], rotation: [ 0, 0, 0 ], args: [ 5, 2, 3 ]},
    { position: [ -x, 2, -z ], rotation: [ 0, 0, 0 ], args: [ 5, 2, 3 ]},
  ])(28, 18)

  const bases: BattleArena['bases'] = {
    red:  { position: [ 0, 0, -74 ], flagRest: [ 0, 1.2, -74 ]},
    blue: { position: [ 0, 0, 74 ], flagRest: [ 0, 1.2, 74 ]},
  }

  const controlPoints: ControlPointDef[] = [
    { id: 'near', name: 'North Yard', position: [ 0, 0, -38 ], radius: 13 },
    { id: 'mid', name: 'Apex Middle', position: [ 0, 0, 0 ], radius: 15 },
    { id: 'far', name: 'South Yard', position: [ 0, 0, 38 ], radius: 13 },
  ]

  return {
    id:         'apex',
    name:       'Apex Basin',
    tagline:    'Symmetric CTF arena — three control zones on the midline.',
    background: '#0a0c14',
    fog:        FOG,
    bloom:      { strength: 0.3, threshold: 0.9, radius: 0.45 },
    floorY:     0,

    colliders:      [ ...ground, ...cover ],
    colliderOffset: [ 0, 0, 0 ],

    bases,
    spawns: {
      red:  [ RED_SPAWN, RED_SPAWN_L, RED_SPAWN_R ],
      blue: [ BLUE_SPAWN, BLUE_SPAWN_L, BLUE_SPAWN_R ],
    },

    controlPoints,
    captureTime:    2.5,
    decayTime:      6,
    zonePeriod:     1.5,
    flagReturnTime: 5,

    buildVisual (ctx) {
      const scene = ctx.scene

      // Split deck: tint each half toward its team so you know whose side
      // you are diving into at a glance.
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(HALF * 2, HALF * 2),
        new THREE.MeshStandardMaterial({ color: '#14151f', metalness: 0.1, roughness: 0.95 })
      )
      floor.rotation.x    = -Math.PI / 2
      floor.receiveShadow = true
      scene.add(floor)

      for (const team of BATTLE_TEAMS) {
        const sign = team === 'red' ? -1 : 1
        const half = new THREE.Mesh(
          new THREE.PlaneGeometry(HALF * 2, HALF),
          new THREE.MeshStandardMaterial({
            color:               TEAM_COLORS[team],
            emissive:            TEAM_COLORS[team],
            emissiveIntensity:   0.045,
            transparent:         true,
            opacity:             0.12,
            polygonOffset:       true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits:  -1,
          })
        )
        half.rotation.x = -Math.PI / 2
        half.position.set(0, 0.01, sign * (HALF / 2))
        scene.add(half)
      }

      const grid      = new THREE.GridHelper(HALF * 2, 80, '#3a3f55', '#23263a')
      grid.position.y = 0.02
      scene.add(grid)

      // Base pylons holding each team's flag.
      for (const team of BATTLE_TEAMS) {
        const { position } = bases[team]
        const pylon        = new THREE.Mesh(
          new THREE.CylinderGeometry(0.35, 0.45, 4, 12),
          new THREE.MeshStandardMaterial({
            color:             TEAM_COLORS[team],
            emissive:          TEAM_COLORS[team],
            emissiveIntensity: 0.5,
          })
        )
        pylon.position.set(position[0], 2, position[2])
        scene.add(pylon)
      }

      // Control zones are painted by the battle visual layer (per-ring
      // materials for ownership colours) — not static geometry here.

      scene.add(new THREE.HemisphereLight('#8a9bff', '#0a0c14', 0.7))
      scene.add(createArenaLight(0, 60, 0))

      scene.fog = new THREE.Fog(FOG[0], FOG[1], FOG[2])
    },
  }
}

function createArenaLight (x: number, y: number, z: number): THREE.Light {
  const light = new THREE.PointLight('#aab4ff', 120, 500)
  light.position.set(x, y, z)
  return light
}
