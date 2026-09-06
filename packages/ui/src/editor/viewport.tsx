'use client'

import { useCallback, useMemo, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react'
import { TEAM_COLORS } from 'Ψarena'

import { gridPitch, snapTo, toWorld, viewBox, zoomAbout } from './projection'
import type { Camera } from './projection'
import type { CompiledRace } from './compile'
import type { EditorDocument } from './document'
import type { Tool } from './reducer'
import styles from './map-editor.module.css'


/**
 * The plan view.
 *
 * SVG in WORLD COORDINATES, with the camera living entirely in the `viewBox` —
 * so a node is drawn at its own metres, hit-testing is the DOM's job, and every
 * stroke stays one pixel through `vector-effect`. The old viewport drew into a
 * fixed 860×520 box through a hand-rolled isometric transform, which is why
 * pointer→grid needed its own inverse and got clamped to 12 units.
 *
 * The ribbon outline is the COMPILED one: the same `buildTrack` sweep the game
 * would drive on, tapered by the same per-node widths, not a stroked bezier
 * approximating it.
 */

type ViewportProps = {
  document:   EditorDocument;
  compiled:   CompiledRace | null;
  camera:     Camera;
  tool:       Tool;
  selected:   string | null;
  onCamera:   (camera: Camera) => void;
  onSelect:   (id: string | null) => void;
  onPlace:    (x: number, z: number) => void;
  onDragItem: (id: string, x: number, z: number) => void;
}

/** Which drag is in flight. `null` between gestures — no drag, no pan. */
type Gesture =
  | { kind: 'pan'; startX: number; startY: number; camX: number; camZ: number } |
  { kind: 'item'; id: string } |
  null

export function Viewport ({
  document: doc, compiled, camera, tool, selected, onCamera, onSelect, onPlace, onDragItem,
}: ViewportProps) {
  const svgRef  = useRef<SVGSVGElement>(null)
  const gesture = useRef<Gesture>(null)
  const pitch   = gridPitch(camera.scale)
  const dragged = useRef(false)

  const worldAt = useCallback((clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect()
    return rect ? toWorld(camera, rect, clientX, clientY) : { x: 0, z: 0 }
  }, [ camera ])

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    const target = (event.target as Element).closest('[data-item]')
    const id     = target?.getAttribute('data-item') ?? null
    event.currentTarget.setPointerCapture(event.pointerId)
    dragged.current = false

    if (id) {
      onSelect(id)
      gesture.current = { kind: 'item', id }
      return
    }

    // Middle button, or the select tool on empty deck, pans. Every other tool
    // places — so the primary gesture is always the one the toolbar advertises.
    if (event.button === 1 || tool === 'select') {
      gesture.current = { kind: 'pan', startX: event.clientX, startY: event.clientY, camX: camera.x, camZ: camera.z }
      onSelect(null)
      return
    }

    const world = worldAt(event.clientX, event.clientY)
    const free  = event.altKey
    onPlace(free ? world.x : snapTo(world.x, pitch), free ? world.z : snapTo(world.z, pitch))
  }

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const active = gesture.current
    if (!active)
      return

    dragged.current = true
    if (active.kind === 'pan') {
      const rect = svgRef.current?.getBoundingClientRect()
      if (!rect)
        return

      // Pan in world units: the drag has to track the deck under the cursor, so
      // pixels are converted through the same scale the viewBox uses.
      const perPixel = 1200 / camera.scale / Math.max(rect.width, 1)
      onCamera({
        ...camera,
        x: active.camX - (event.clientX - active.startX) * perPixel,
        z: active.camZ - (event.clientY - active.startY) * perPixel,
      })
      return
    }

    const world = worldAt(event.clientX, event.clientY)
    const free  = event.altKey
    onDragItem(active.id, free ? world.x : snapTo(world.x, pitch), free ? world.z : snapTo(world.z, pitch))
  }

  const endGesture = () => {
    gesture.current = null
  }

  const onWheel = (event: ReactWheelEvent<SVGSVGElement>) => {
    onCamera(zoomAbout(camera, worldAt(event.clientX, event.clientY), Math.exp(-event.deltaY * 0.0016)))
  }

  return <svg
    ref={ svgRef }
    className={ styles.canvas }
    viewBox={ viewBox(camera) }
    preserveAspectRatio="xMidYMid slice"
    role="application"
    aria-label={ `${doc.kind} map plan view` }
    onPointerDown={ onPointerDown }
    onPointerMove={ onPointerMove }
    onPointerUp={ endGesture }
    onPointerCancel={ endGesture }
    onWheel={ onWheel }>

    <Grid camera={ camera } pitch={ pitch } />

    { doc.kind === 'race'
      ? <RaceLayer document={ doc } compiled={ compiled } selected={ selected } />
      : <BattleLayer document={ doc } selected={ selected } /> }
  </svg>
}

/** Metric grid plus the world axes, sized to whatever the camera can see. */
type GridProps = { camera: Camera; pitch: number }

function Grid ({ camera, pitch }: GridProps) {
  const lines = useMemo(() => {
    const halfW = 1200 / camera.scale / 2
    const halfH = 720 / camera.scale / 2
    const minX  = Math.floor((camera.x - halfW) / pitch) * pitch
    const maxX  = camera.x + halfW
    const minZ  = Math.floor((camera.z - halfH) / pitch) * pitch
    const maxZ  = camera.z + halfH

    const vertical: number[]   = []
    const horizontal: number[] = []
    // Bounded so a zoomed-out view cannot emit ten thousand elements.
    for (let x = minX; x <= maxX && vertical.length < 240; x += pitch)
      vertical.push(x)
    for (let z = minZ; z <= maxZ && horizontal.length < 240; z += pitch)
      horizontal.push(z)

    return { vertical, horizontal, minX, maxX, minZ, maxZ }
  }, [ camera, pitch ])

  return <g className={ styles.grid }>
    { lines.vertical.map(x =>
      <line key={ `v${x}` } x1={ x } y1={ lines.minZ } x2={ x } y2={ lines.maxZ } vectorEffect="non-scaling-stroke" />) }

    { lines.horizontal.map(z =>
      <line key={ `h${z}` } x1={ lines.minX } y1={ z } x2={ lines.maxX } y2={ z } vectorEffect="non-scaling-stroke" />) }

    <line className={ styles.axis } x1={ lines.minX } y1={ 0 } x2={ lines.maxX } y2={ 0 } vectorEffect="non-scaling-stroke" />
    <line className={ styles.axis } x1={ 0 } y1={ lines.minZ } x2={ 0 } y2={ lines.maxZ } vectorEffect="non-scaling-stroke" />
  </g>
}

/** The compiled ribbon, the centreline, and one handle per control point. */
type RaceLayerProps = { document: EditorDocument; compiled: CompiledRace | null; selected: string | null }

function RaceLayer ({ document: doc, compiled, selected }: RaceLayerProps) {
  const deck = useMemo(() => compiled ? ribbonOutline(compiled.vertices, doc.race.loop) : '', [ compiled, doc.race.loop ])
  const line = useMemo(() => compiled ? centrePath(compiled.vertices) : '', [ compiled ])

  return <g>
    <path className={ styles.deck } d={ deck } vectorEffect="non-scaling-stroke" />
    <path className={ styles.centre } d={ line } vectorEffect="non-scaling-stroke" />

    { doc.race.nodes.map((node, index) => {
      const active = selected === node.id
      const radius = Math.max(node.width * 0.2, 3)
      return <g key={ node.id } data-item={ node.id } className={ active ? styles.nodeActive : styles.node }>
        <circle cx={ node.x } cy={ node.z } r={ radius } vectorEffect="non-scaling-stroke" />
        { index === 0 && <StartLine node={ node } next={ doc.race.nodes[1] } /> }

        <text x={ node.x } y={ node.z } dy="0.35em" className={ styles.nodeLabel }>
          { String(index + 1).padStart(2, '0') }
        </text>

        { node.y !== 0 && <text x={ node.x } y={ node.z } dy={ -radius - 4 } className={ styles.nodeAltitude }>
          { node.y > 0 ? '+' : '' }{ Math.round(node.y) }m
        </text> }
      </g>
    }) }
  </g>
}

/** Gate 0, drawn across the road the way the checkpoint plane actually spans it. */
type StartLineProps = { node: { x: number; z: number; width: number }; next?: { x: number; z: number }}

function StartLine ({ node, next }: StartLineProps) {
  if (!next)
    return null

  const dx     = next.x - node.x
  const dz     = next.z - node.z
  const length = Math.hypot(dx, dz) || 1
  const nx     = -dz / length * node.width * 0.5
  const nz     = dx / length * node.width * 0.5

  return <line
    className={ styles.startLine }
    x1={ node.x - nx } y1={ node.z - nz } x2={ node.x + nx }
    y2={ node.z + nz }
    vectorEffect="non-scaling-stroke" />
}

/** Deck outline, mesas, zones, bases and spawns. */
type BattleLayerProps = { document: EditorDocument; selected: string | null }

function BattleLayer ({ document: doc, selected }: BattleLayerProps) {
  const { battle } = doc
  const half       = battle.half

  return <g>
    <rect className={ styles.deck } x={ -half } y={ -half } width={ half * 2 } height={ half * 2 } vectorEffect="non-scaling-stroke" />

    { battle.plateaus.map(p =>
      <g key={ p.id } data-item={ p.id } className={ selected === p.id ? styles.mesaActive : styles.mesa }>
        <rect
          x={ p.centreX - p.halfX } y={ p.centreZ - p.halfZ }
          width={ p.halfX * 2 } height={ p.halfZ * 2 }
          vectorEffect="non-scaling-stroke" />

        { p.ramps.map(side => <Ramp key={ side } plateau={ p } side={ side } />) }
        <text x={ p.centreX } y={ p.centreZ } dy="0.35em" className={ styles.itemLabel }>{ p.name }</text>
        <text x={ p.centreX } y={ p.centreZ } dy="1.7em" className={ styles.itemSub }>{ p.height }m</text>
      </g>) }

    { battle.zones.map(z =>
      <g key={ z.id } data-item={ z.id } className={ selected === z.id ? styles.zoneActive : styles.zone }>
        <circle cx={ z.x } cy={ z.z } r={ z.radius } vectorEffect="non-scaling-stroke" />
        <text x={ z.x } y={ z.z } dy="0.35em" className={ styles.itemLabel }>{ z.short }</text>
      </g>) }

    { battle.bases.map(base =>
      <g key={ base.team } data-item={ `base-${base.team}` } className={ styles.base }>
        <circle cx={ base.x } cy={ base.z } r={ 18 } fill={ TEAM_COLORS[base.team] } fillOpacity={ 0.2 } stroke={ TEAM_COLORS[base.team] } vectorEffect="non-scaling-stroke" />
        <text x={ base.x } y={ base.z } dy="0.35em" className={ styles.itemLabel }>{ base.team === 'red' ? 'R' : 'B' }</text>
      </g>) }

    { battle.spawns.map(s =>
      <g key={ s.id } data-item={ s.id } className={ selected === s.id ? styles.spawnActive : styles.spawn }>
        <path
          d={ spawnArrow(s.x, s.z, s.yaw) }
          fill={ TEAM_COLORS[s.team] } fillOpacity={ 0.5 }
          stroke={ TEAM_COLORS[s.team] } vectorEffect="non-scaling-stroke" />
      </g>) }
  </g>
}

/** A ramp's footprint on the deck, at the slope the arena compiler will build. */
type RampProps = { plateau: EditorDocument['battle']['plateaus'][number]; side: string }

function Ramp ({ plateau, side }: RampProps) {
  const run   = plateau.height * 4.2
  const width = 13

  const [ x, y, w, h ] =
    side === '+z'
      ? [ plateau.centreX - width, plateau.centreZ + plateau.halfZ, width * 2, run ]
      : side === '-z'
        ? [ plateau.centreX - width, plateau.centreZ - plateau.halfZ - run, width * 2, run ]
        : side === '+x'
          ? [ plateau.centreX + plateau.halfX, plateau.centreZ - width, run, width * 2 ]
          : [ plateau.centreX - plateau.halfX - run, plateau.centreZ - width, run, width * 2 ]

  return <rect className={ styles.ramp } x={ x } y={ y } width={ w } height={ h } vectorEffect="non-scaling-stroke" />
}

function spawnArrow (x: number, z: number, yaw: number): string {
  const rad = yaw * Math.PI / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  // Nose along -z at yaw 0, matching the identity quaternion the compiler emits.
  const at  = (fx: number, fz: number) => `${x + fx * cos + fz * sin},${z - fx * sin + fz * cos}`
  return `M ${at(0, -16)} L ${at(10, 8)} L ${at(0, 3)} L ${at(-10, 8)} Z`
}

/** Left edge out, right edge back — one closed path around the swept deck. */
function ribbonOutline (vertices: Float32Array, loop: boolean): string {
  const rings = Math.floor(vertices.length / 6)
  if (rings < 2)
    return ''

  const left: string[]  = []
  const right: string[] = []
  for (let i = 0; i < rings; i++) {
    left.push(`${vertices[i * 6]},${vertices[i * 6 + 2]}`)
    right.push(`${vertices[i * 6 + 3]},${vertices[i * 6 + 5]}`)
  }
  right.reverse()
  return `M ${left.join(' L ')} L ${right.join(' L ')}${loop ? ' Z' : ''}`
}

function centrePath (vertices: Float32Array): string {
  const rings            = Math.floor(vertices.length / 6)
  const points: string[] = []
  for (let i = 0; i < rings; i++)
    points.push(`${(vertices[i * 6] + vertices[i * 6 + 3]) / 2},${(vertices[i * 6 + 2] + vertices[i * 6 + 5]) / 2}`)
  return points.length ? `M ${points.join(' L ')}` : ''
}
