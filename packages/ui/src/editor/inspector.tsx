'use client'

import { BATTLE_TEAMS } from 'Ψarena'
import type { RampSide } from 'Ψarena'

import { ColorField, Group, NumberField, Readout, TextField, ToggleField } from './fields'
import type { CompiledRace } from './compile'
import type { EditorAction } from './reducer'
import type { EditorDocument } from './document'
import styles from './map-editor.module.css'


const RAMP_SIDES: RampSide[] = [ '+x', '-x', '+z', '-z' ]

type InspectorProps = {
  document:       EditorDocument;
  compiled:       CompiledRace | null;
  arenaColliders: number;
  selected:       string | null;
  dispatch:       (action: EditorAction) => void;
}

/**
 * The right-hand panel: whatever is selected, then the map-wide settings.
 *
 * Every control writes an ACTION, never state. That is what lets undo cover the
 * inspector as well as the canvas — the old panel called five different
 * `setX(...)` closures from inside JSX and nothing could observe an edit.
 */
export function Inspector ({ document: doc, compiled, arenaColliders, selected, dispatch }: InspectorProps) {
  return <aside className={ styles.inspector } aria-label="Inspector">
    <h2>Inspector</h2>

    { doc.kind === 'race'
      ? <RaceInspector document={ doc } compiled={ compiled } selected={ selected } dispatch={ dispatch } />
      : <BattleInspector document={ doc } arenaColliders={ arenaColliders } selected={ selected } dispatch={ dispatch } /> }

    <Group title="Identity">
      <TextField label="Name" value={ doc.name } onChange={ name => dispatch({ type: 'meta', patch: { name }}) } />
      <TextField label="Id" value={ doc.id } onChange={ id => dispatch({ type: 'meta', patch: { id }}) } />
      <TextField label="Tagline" value={ doc.tagline } onChange={ tagline => dispatch({ type: 'meta', patch: { tagline }}) } />
    </Group>

    <Group title="Environment">
      <ColorField label="Sky" value={ doc.environment.background } onChange={ background => dispatch({ type: 'environment', patch: { background }}) } />
      <ColorField label="Fog" value={ doc.environment.fogColor } onChange={ fogColor => dispatch({ type: 'environment', patch: { fogColor }}) } />

      <NumberField
        label="Fog near" value={ doc.environment.fogNear } min={ 0 }
        max={ 1200 } step={ 10 } unit="m"
        onChange={ fogNear => dispatch({ type: 'environment', patch: { fogNear }}) } />

      <NumberField
        label="Fog far" value={ doc.environment.fogFar } min={ 100 }
        max={ 3000 } step={ 10 } unit="m"
        onChange={ fogFar => dispatch({ type: 'environment', patch: { fogFar }}) } />

      <NumberField
        label="Bloom" value={ doc.environment.bloomStrength } min={ 0 }
        max={ 2 } step={ 0.05 }
        onChange={ bloomStrength => dispatch({ type: 'environment', patch: { bloomStrength }}) } />

      <NumberField
        label="Bloom threshold" value={ doc.environment.bloomThreshold } min={ 0 }
        max={ 1 } step={ 0.01 }
        onChange={ bloomThreshold => dispatch({ type: 'environment', patch: { bloomThreshold }}) } />

      <NumberField
        label="Bloom radius" value={ doc.environment.bloomRadius } min={ 0 }
        max={ 1.5 } step={ 0.01 }
        onChange={ bloomRadius => dispatch({ type: 'environment', patch: { bloomRadius }}) } />
    </Group>
  </aside>
}

type RaceInspectorProps = {
  document: EditorDocument;
  compiled: CompiledRace | null;
  selected: string | null;
  dispatch: (action: EditorAction) => void;
}

function RaceInspector ({ document: doc, compiled, selected, dispatch }: RaceInspectorProps) {
  const index = doc.race.nodes.findIndex(n => n.id === selected)
  const node  = index < 0 ? null : doc.race.nodes[index]

  return <>
    { node
      ? <Group title={ `Node ${String(index + 1).padStart(2, '0')}` }>
        <NumberField
          label="Road width" value={ node.width } min={ 8 }
          max={ 80 } step={ 1 } unit="m"
          onChange={ width => dispatch({ type: 'node.patch', id: node.id, patch: { width }}) } />

        <NumberField
          label="Elevation" value={ node.y } min={ -60 }
          max={ 120 } step={ 1 } unit="m"
          onChange={ y => dispatch({ type: 'node.patch', id: node.id, patch: { y }}) } />

        <NumberField
          label="X" value={ node.x } min={ -1500 }
          max={ 1500 } step={ 1 } unit="m"
          onChange={ x => dispatch({ type: 'node.patch', id: node.id, patch: { x }}) } />

        <NumberField
          label="Z" value={ node.z } min={ -1500 }
          max={ 1500 } step={ 1 } unit="m"
          onChange={ z => dispatch({ type: 'node.patch', id: node.id, patch: { z }}) } />

        <button
          className={ styles.danger }
          disabled={ doc.race.nodes.length <= 2 }
          onClick={ () => dispatch({ type: 'node.remove', id: node.id }) }>
          Delete node
        </button>
      </Group>
      : <p className={ styles.empty }>Select a control point, or pick the route tool and click the deck to append one.</p> }

    <Group title="Circuit">
      <ToggleField label="Closed circuit" value={ doc.race.loop } onChange={ loop => dispatch({ type: 'race', patch: { loop }}) } />

      <NumberField
        label="Laps" value={ doc.race.laps } min={ 1 }
        max={ 20 } step={ 1 }
        onChange={ laps => dispatch({ type: 'race', patch: { laps }}) } />

      <NumberField
        label="Spline resolution" value={ doc.race.segments } min={ 4 }
        max={ 48 } step={ 1 }
        onChange={ segments => dispatch({ type: 'race', patch: { segments }}) } />

      <NumberField
        label="Banking" value={ doc.race.banking } min={ 0 }
        max={ 1.2 } step={ 0.01 } unit=" rad"
        onChange={ banking => dispatch({ type: 'race', patch: { banking }}) } />

      <button onClick={ () => dispatch({ type: 'node.reverse' }) }>Reverse direction</button>
    </Group>

    <Readout
      rows={ [
        [ 'Control points', String(doc.race.nodes.length) ],
        [ 'Centreline', compiled ? `${Math.round(compiled.length)} m` : '—' ],
        [ 'Colliders', compiled ? String(compiled.spec.colliders.length) : '—' ],
        [ 'Gates', compiled ? String(compiled.spec.waypoints.length) : '—' ],
        [ 'Race distance', compiled ? `${Math.round(compiled.length * (doc.race.loop ? doc.race.laps : 1))} m` : '—' ],
      ] } />
  </>
}

type BattleInspectorProps = {
  document:       EditorDocument;
  arenaColliders: number;
  selected:       string | null;
  dispatch:       (action: EditorAction) => void;
}

function BattleInspector ({ document: doc, arenaColliders, selected, dispatch }: BattleInspectorProps) {
  const { battle } = doc
  const plateau    = battle.plateaus.find(p => p.id === selected)
  const zone       = battle.zones.find(z => z.id === selected)
  const spawn      = battle.spawns.find(s => s.id === selected)

  return <>
    { plateau && <Group title="Mesa">
      <TextField label="Name" value={ plateau.name } onChange={ name => dispatch({ type: 'plateau.patch', id: plateau.id, patch: { name }}) } />

      <NumberField
        label="Height" value={ plateau.height } min={ 4 }
        max={ 60 } step={ 1 } unit="m"
        onChange={ height => dispatch({ type: 'plateau.patch', id: plateau.id, patch: { height }}) } />

      <NumberField
        label="Half X" value={ plateau.halfX } min={ 10 }
        max={ 200 } step={ 1 } unit="m"
        onChange={ halfX => dispatch({ type: 'plateau.patch', id: plateau.id, patch: { halfX }}) } />

      <NumberField
        label="Half Z" value={ plateau.halfZ } min={ 10 }
        max={ 200 } step={ 1 } unit="m"
        onChange={ halfZ => dispatch({ type: 'plateau.patch', id: plateau.id, patch: { halfZ }}) } />

      <div className={ styles.chips } role="group" aria-label="Ramp faces">
        { RAMP_SIDES.map(side => {
          const on = plateau.ramps.includes(side)
          return <button
            key={ side }
            aria-pressed={ on }
            onClick={ () => dispatch({
              type:  'plateau.patch',
              id:    plateau.id,
              patch: { ramps: on ? plateau.ramps.filter(s => s !== side) : [ ...plateau.ramps, side ]},
            }) }>
            ramp { side }
          </button>
        }) }
      </div>

      <p className={ styles.hint }>
        A mesa with no ramp is a wall: the hover rays only find its top from above, and a
        ship that drives into the vertical face pins itself there.
      </p>

      <button className={ styles.danger } onClick={ () => dispatch({ type: 'remove', id: plateau.id }) }>Delete mesa</button>
    </Group> }

    { zone && <Group title="Capture zone">
      <TextField label="Name" value={ zone.name } onChange={ name => dispatch({ type: 'zone.patch', id: zone.id, patch: { name }}) } />
      <TextField label="Pip" value={ zone.short } onChange={ short => dispatch({ type: 'zone.patch', id: zone.id, patch: { short }}) } />

      <NumberField
        label="Radius" value={ zone.radius } min={ 8 }
        max={ 120 } step={ 1 } unit="m"
        onChange={ radius => dispatch({ type: 'zone.patch', id: zone.id, patch: { radius }}) } />

      <NumberField
        label="Deck height" value={ zone.y } min={ -10 }
        max={ 80 } step={ 1 } unit="m"
        onChange={ y => dispatch({ type: 'zone.patch', id: zone.id, patch: { y }}) } />

      <button className={ styles.danger } onClick={ () => dispatch({ type: 'remove', id: zone.id }) }>Delete zone</button>
    </Group> }

    { spawn && <Group title="Spawn point">
      <NumberField
        label="Facing" value={ spawn.yaw } min={ 0 }
        max={ 359 } step={ 1 } unit="°"
        onChange={ yaw => dispatch({ type: 'spawn.patch', id: spawn.id, patch: { yaw }}) } />

      <div className={ styles.chips } role="group" aria-label="Team">
        { BATTLE_TEAMS.map(team => <button
          key={ team }
          aria-pressed={ spawn.team === team }
          onClick={ () => dispatch({ type: 'spawn.patch', id: spawn.id, patch: { team }}) }>
          { team }
        </button>) }
      </div>

      <button className={ styles.danger } onClick={ () => dispatch({ type: 'remove', id: spawn.id }) }>Delete spawn</button>
    </Group> }

    { !plateau && !zone && !spawn &&
      <p className={ styles.empty }>Select a mesa, zone or spawn — or pick a placement tool and click the deck.</p> }

    <Group title="Arena">
      <NumberField
        label="Deck half-extent" value={ battle.half } min={ 80 }
        max={ 600 } step={ 10 } unit="m"
        onChange={ half => dispatch({ type: 'battle', patch: { half }}) } />

      <NumberField
        label="Capture time" value={ battle.captureTime } min={ 1 }
        max={ 30 } step={ 0.5 } unit="s"
        onChange={ captureTime => dispatch({ type: 'battle', patch: { captureTime }}) } />

      <NumberField
        label="Contest drain" value={ battle.contestDrain } min={ 0.5 }
        max={ 20 } step={ 0.5 } unit="s"
        onChange={ contestDrain => dispatch({ type: 'battle', patch: { contestDrain }}) } />

      <NumberField
        label="Score period" value={ battle.zonePeriod } min={ 1 }
        max={ 20 } step={ 0.5 } unit="s"
        onChange={ zonePeriod => dispatch({ type: 'battle', patch: { zonePeriod }}) } />

      <NumberField
        label="Flag return" value={ battle.flagReturnTime } min={ 2 }
        max={ 90 } step={ 1 } unit="s"
        onChange={ flagReturnTime => dispatch({ type: 'battle', patch: { flagReturnTime }}) } />
    </Group>

    <Readout
      rows={ [
        [ 'Mesas', String(battle.plateaus.length) ],
        [ 'Zones', String(battle.zones.length) ],
        [ 'Spawns', `${battle.spawns.filter(s => s.team === 'red').length} red · ${battle.spawns.filter(s => s.team === 'blue').length} blue` ],
        [ 'Colliders', String(arenaColliders) ],
        [ 'Deck', `${battle.half * 2} × ${battle.half * 2} m` ],
      ] } />
  </>
}
