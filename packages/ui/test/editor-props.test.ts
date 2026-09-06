import { describe, expect, it } from 'vitest'
import { editorReducer, initialEditorState } from 'Ʊeditor/reducer'
import { normaliseDocument } from 'Ʊeditor/document'
import { compileRace } from 'Ʊeditor/compile'
import { PROP_CATALOGUE, propColliders } from 'Ȼprops'


/**
 * Props are the one collection both map kinds share, and the one that reaches
 * the physics world without going through the ribbon builder. These cover the
 * two places that can go wrong: the reducer's bookkeeping, and whether a solid
 * prop actually turns into something the ship can hit.
 */
const place = (state = initialEditorState('race'), kind = 'archway' as const) =>
  editorReducer(state, { type: 'prop.add', kind, x: 40, z: -60 })

describe('editor props', () => {
  it('places a prop, selects it, and makes it undoable', () => {
    const before = initialEditorState('race')
    const after  = place(before)

    expect(after.document.props).toHaveLength(1)
    expect(after.selected).toBe(after.document.props[0].id)
    expect(after.past).toHaveLength(1)

    const undone = editorReducer(after, { type: 'undo' })
    expect(undone.document.props).toHaveLength(0)
  })

  it('does not make arming the palette undoable', () => {
    // Which prop is armed is view state, exactly like the tool and the
    // selection. An undo stack full of palette clicks is an undo stack nobody
    // can use to walk back a bad corner.
    const armed = editorReducer(initialEditorState('race'), { type: 'prop.pick', kind: 'beacon' })

    expect(armed.prop).toBe('beacon')
    expect(armed.tool).toBe('prop')
    expect(armed.past).toHaveLength(0)
  })

  it('removes a prop on either kind of map', () => {
    const placed  = place(initialEditorState('battle'))
    const removed = editorReducer(placed, { type: 'remove', id: placed.document.props[0].id })

    expect(removed.document.props).toHaveLength(0)
    expect(removed.selected).toBeNull()
  })

  it('compiles solid props into colliders and decorative ones into nothing', () => {
    const solid      = place()
    const decorative = editorReducer(solid, { type: 'prop.add', kind: 'holo-sign', x: -40, z: 20 })

    expect(PROP_CATALOGUE.archway.half).not.toBeNull()
    expect(PROP_CATALOGUE['holo-sign'].half).toBeNull()

    const boxes = propColliders(decorative.document.props)
    expect(boxes).toHaveLength(1)
    for (const n of [ ...boxes[0].position, ...boxes[0].rotation, ...boxes[0].args ])
      expect(Number.isFinite(n)).toBe(true)

    // A placement's `y` is where the prop STANDS; a collider is centred, so it
    // has to sit half its own height above that or it is buried in the road.
    expect(boxes[0].position[1]).toBeCloseTo(PROP_CATALOGUE.archway.half![1], 6)
  })

  it('puts prop colliders into the compiled track alongside the deck and walls', () => {
    const withProp = place()
    const bare     = compileRace(initialEditorState('race').document)
    const dressed  = compileRace(withProp.document)

    expect(dressed.spec.colliders.length).toBe(bare.spec.colliders.length + 1)
  })

  it('drops props it does not recognise on import', () => {
    // Import is the one place a hand-edited file reaches the reducer, and an
    // unknown kind is a crash in the geometry builder later.
    const document = normaliseDocument({
      kind:  'race',
      props: [
        { id: 'a', kind: 'pylon', x: 0, y: 0, z: 0, yaw: 0, scale: 1 },
        { id: 'b', kind: 'not-a-prop', x: 0, y: 0, z: 0, yaw: 0, scale: 1 },
        { id: 'c', kind: 'beacon', x: 'nope', y: 0, z: 0, yaw: 0, scale: 1 },
      ],
    })

    expect(document.props.map(prop => prop.kind)).toEqual([ 'pylon' ])
  })
})
