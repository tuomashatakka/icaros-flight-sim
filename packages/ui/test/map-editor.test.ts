import { beforeEach, describe, expect, it } from 'vitest'
import { compileBattle, compileRace, validate } from 'Ʊeditor/compile'
import { createDocument, normaliseDocument, resetIds } from 'Ʊeditor/document'
import type { EditorDocument } from 'Ʊeditor/document'
import { editorReducer, initialEditorState } from 'Ʊeditor/reducer'
import type { EditorAction, EditorState } from 'Ʊeditor/reducer'
import { frame, gridPitch, snapTo, toWorld, zoomAbout } from 'Ʊeditor/projection'


/**
 * The forge's brain, tested without a DOM.
 *
 * That is the whole reason the rewrite split the document, the reducer, the
 * compiler and the projection out of the component: the editor it replaced kept
 * everything in eight `useState` hooks inside JSX handlers, so there was no
 * seam here at all and no way to assert that what it drew was a track the game
 * could load.
 */

const RECT = { left: 0, top: 0, width: 1200, height: 720 }

const run = (state: EditorState, ...actions: EditorAction[]): EditorState =>
  actions.reduce(editorReducer, state)

beforeEach(resetIds)

describe('the document', () => {
  it('opens on a circuit whose first three nodes are colinear', () => {
    const doc         = createDocument('race')
    const [ a, b, c ] = doc.race.nodes

    // The grid spawns on gate 0; a spline already curving there banks the deck
    // out from under a ship that has not moved yet.
    expect(a.x).toBe(b.x)
    expect(b.x).toBe(c.x)
    expect(validate(doc).filter(i => i.level === 'error')).toEqual([])
  })

  it('normalises a hostile parse into something the reducer can hold', () => {
    for (const junk of [ null, 42, 'nope', [], { kind: 'sideways' }, { race: { nodes: 'no' }}]) {
      const doc = normaliseDocument(junk)
      expect(doc.race.nodes.length).toBeGreaterThanOrEqual(2)
      expect(doc.battle.bases).toHaveLength(2)
      expect([ 'race', 'battle' ]).toContain(doc.kind)
    }
  })

  it('keeps authored nodes on a round trip through JSON', () => {
    const before = createDocument('race')
    const after  = normaliseDocument(JSON.parse(JSON.stringify(before)))
    expect(after.race.nodes).toEqual(before.race.nodes)
  })

  it('drops a route too short to be a track and falls back to factory', () => {
    const doc = normaliseDocument({ kind: 'race', race: { nodes: [{ x: 0, y: 0, z: 0, width: 20 }]}})
    expect(doc.race.nodes.length).toBeGreaterThan(2)
  })
})

describe('the reducer', () => {
  it('appends a node inheriting its neighbour elevation and width', () => {
    const start = initialEditorState('race')
    const last  = start.document.race.nodes[start.document.race.nodes.length - 1]
    const next  = run(start, { type: 'tool', tool: 'route' }, { type: 'node.add', x: 400, z: 400 })
    const added = next.document.race.nodes[next.document.race.nodes.length - 1]

    expect(added.x).toBe(400)
    expect(added.y).toBe(last.y)
    expect(added.width).toBe(last.width)
    expect(next.selected).toBe(added.id)
  })

  it('refuses to leave fewer than two control points', () => {
    let state = initialEditorState('race')
    for (const node of [ ...state.document.race.nodes ])
      state = run(state, { type: 'node.remove', id: node.id })

    expect(state.document.race.nodes).toHaveLength(2)
  })

  it('undoes a document edit but never a selection', () => {
    const start  = initialEditorState('race')
    const target = start.document.race.nodes[0].id

    const edited = run(start,
                       { type: 'select', id: target },
                       { type: 'node.patch', id: target, patch: { width: 44 }})

    expect(edited.document.race.nodes[0].width).toBe(44)

    const undone = run(edited, { type: 'undo' })
    expect(undone.document.race.nodes[0].width).toBe(start.document.race.nodes[0].width)
    // Selection is view state: undo must not move the cursor off what you were editing.
    expect(undone.selected).toBe(target)

    expect(run(undone, { type: 'redo' }).document.race.nodes[0].width).toBe(44)
  })

  it('clears the redo stack once a new edit lands on top of an undo', () => {
    const start  = initialEditorState('race')
    const target = start.document.race.nodes[0].id
    const state  = run(start,
                       { type: 'node.patch', id: target, patch: { width: 44 }},
                       { type: 'undo' },
                       { type: 'node.patch', id: target, patch: { width: 30 }})

    expect(state.future).toHaveLength(0)
    expect(state.document.race.nodes[0].width).toBe(30)
  })

  it('keeps the last spawn of each team', () => {
    let state = initialEditorState('battle')
    for (const spawn of [ ...state.document.battle.spawns ])
      state = run(state, { type: 'remove', id: spawn.id })

    for (const team of [ 'red', 'blue' ] as const)
      expect(state.document.battle.spawns.filter(s => s.team === team)).toHaveLength(1)
  })

  it('drops a zone onto the mesa it lands on, not through it', () => {
    const start   = initialEditorState('battle')
    const plateau = start.document.battle.plateaus[0]
    const state   = run(start, { type: 'zone.add', x: plateau.centreX, z: plateau.centreZ })
    const added   = state.document.battle.zones[state.document.battle.zones.length - 1]

    expect(added.y).toBe(plateau.height)
  })

  it('ignores a race action aimed at a battle document', () => {
    const state = initialEditorState('battle')
    expect(run(state, { type: 'node.patch', id: 'nope', patch: { width: 5 }}).document.battle)
      .toEqual(state.document.battle)
  })
})

describe('the compiler', () => {
  it('emits a TrackSpec the runtime types accept', () => {
    const { spec, length } = compileRace(createDocument('race'))

    expect(spec.waypoints.length).toBe(15)
    expect(spec.loop).toBe(true)
    expect(spec.laps).toBe(3)
    expect(spec.colliders.length).toBeGreaterThan(50)
    expect(length).toBeGreaterThan(100)

    for (const collider of spec.colliders) {
      expect(collider.args.every(Number.isFinite)).toBe(true)
      expect(collider.position.every(Number.isFinite)).toBe(true)
    }
  })

  it('tapers the ribbon to the per-node widths rather than one uniform road', () => {
    const doc: EditorDocument = createDocument('race')
    doc.race.nodes            = doc.race.nodes.map((node, i) => ({ ...node, width: i === 4 ? 60 : 14 }))

    const { vertices }     = compileRace(doc)
    const widths: number[] = []
    for (let i = 0; i < vertices.length / 6; i++)
      widths.push(Math.hypot(
        vertices[i * 6] - vertices[i * 6 + 3],
        vertices[i * 6 + 2] - vertices[i * 6 + 5]
      ))

    expect(Math.max(...widths)).toBeGreaterThan(50)
    expect(Math.min(...widths)).toBeLessThan(20)
  })

  it('emits a BattleArena with a floor, a wall and one collider set per mesa', () => {
    const doc   = createDocument('battle')
    const arena = compileBattle(doc)

    expect(arena.plateaus).toHaveLength(doc.battle.plateaus.length)
    expect(arena.controlPoints).toHaveLength(doc.battle.zones.length)
    expect(arena.spawns.red.length).toBeGreaterThan(0)
    expect(arena.spawns.blue.length).toBeGreaterThan(0)

    // Deck + 4 wall slabs + (mesa + one wedge per ramp) each.
    const ramps = doc.battle.plateaus.reduce((n, p) => n + p.ramps.length, 0)
    expect(arena.colliders).toHaveLength(5 + doc.battle.plateaus.length + ramps)
  })

  it('normalises spawn quaternions', () => {
    const doc         = createDocument('battle')
    doc.battle.spawns = doc.battle.spawns.map(s => ({ ...s, yaw: 137 }))

    for (const spawn of compileBattle(doc).spawns.red) {
      const [ x, y, z, w ] = spawn.quaternion
      expect(Math.hypot(x, y, z, w)).toBeCloseTo(1, 6)
    }
  })
})

describe('validation', () => {
  it('flags a fog range that is inside out', () => {
    const doc               = createDocument('race')
    doc.environment.fogNear = 900
    doc.environment.fogFar  = 200
    expect(validate(doc).some(i => i.level === 'error')).toBe(true)
  })

  it('flags a spawn buried inside a mesa', () => {
    const doc         = createDocument('battle')
    const plateau     = doc.battle.plateaus[0]
    doc.battle.spawns = [
      { id: 's1', team: 'red', x: plateau.centreX, z: plateau.centreZ, yaw: 0 },
      { id: 's2', team: 'blue', x: 0, z: 250, yaw: 180 },
    ]
    expect(validate(doc).some(i => i.message.includes('inside a mesa'))).toBe(true)
  })

  it('flags a team with nowhere to spawn', () => {
    const doc         = createDocument('battle')
    doc.battle.spawns = doc.battle.spawns.filter(s => s.team === 'red')
    expect(validate(doc).some(i => i.message.includes('blue'))).toBe(true)
  })

  it('warns when the opening straight already curves', () => {
    const doc         = createDocument('race')
    doc.race.nodes[1] = { ...doc.race.nodes[1], x: 90 }
    expect(validate(doc).some(i => i.message.includes('colinear'))).toBe(true)
  })
})

describe('the plan-view camera', () => {
  it('keeps the metre under the cursor fixed while zooming', () => {
    const camera = { x: 40, z: -80, scale: 1.5 }
    const anchor = toWorld(camera, RECT, 300, 200)
    const zoomed = zoomAbout(camera, anchor, 2.4)
    const after  = toWorld(zoomed, RECT, 300, 200)

    expect(after.x).toBeCloseTo(anchor.x, 6)
    expect(after.z).toBeCloseTo(anchor.z, 6)
  })

  it('clamps zoom rather than letting it run to zero or infinity', () => {
    expect(zoomAbout({ x: 0, z: 0, scale: 1 }, { x: 0, z: 0 }, 1e6).scale).toBeLessThanOrEqual(12)
    expect(zoomAbout({ x: 0, z: 0, scale: 1 }, { x: 0, z: 0 }, 1e-6).scale).toBeGreaterThanOrEqual(0.25)
  })

  it('frames a set of points inside the viewport', () => {
    const points = createDocument('race').race.nodes
    const camera = frame(points)

    const halfW = 1200 / camera.scale / 2
    const halfH = 720 / camera.scale / 2
    for (const point of points) {
      expect(Math.abs(point.x - camera.x)).toBeLessThanOrEqual(halfW)
      expect(Math.abs(point.z - camera.z)).toBeLessThanOrEqual(halfH)
    }
  })

  it('keeps the grid pitch roughly one line per 60 screen units', () => {
    for (const scale of [ 0.25, 0.6, 1.4, 4, 12 ]) {
      const pitch = gridPitch(scale)
      expect(pitch * scale).toBeGreaterThanOrEqual(60)
      expect(pitch * scale).toBeLessThan(600)
    }
  })

  it('snaps to the pitch it was given', () => {
    expect(snapTo(37, 25)).toBe(25)
    expect(snapTo(-37, 25)).toBe(-25)
    expect(snapTo(63, 25)).toBe(75)
  })
})
