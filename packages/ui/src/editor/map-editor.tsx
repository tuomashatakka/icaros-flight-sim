'use client'

import Link from 'next/link'
import { PointerEvent, useMemo, useState } from 'react'
import styles from './map-editor.module.css'


type MapKind = 'race' | 'battle'
type Tool = 'select' | 'route' | 'raise' | 'lower' | 'prop' | 'control' | 'spawn'
type Point = { id: number, x: number, z: number, y: number, width: number, bankLeft: number, bankRight: number }
type Placed = { id: number, x: number, z: number, kind: string, team?: string }

const SIZE                  = 12
const CELL                  = 42
const ORIGIN_X              = 430
const ORIGIN_Y              = 92
const PROPS                 = [ 'Cargo stack', 'Cooling tower', 'Fuel silo', 'Pipe junction' ]
const TEAMS                 = [ 'Neutral', 'Cyan', 'Magenta' ]
const initialRoute: Point[] = [
  { id: 1, x: 2, z: 8, y: 0, width: 5, bankLeft: 0, bankRight: 0 },
  { id: 2, x: 3, z: 4, y: 1, width: 6, bankLeft: 18, bankRight: 0 },
  { id: 3, x: 7, z: 2, y: 2, width: 7, bankLeft: 32, bankRight: 24 },
  { id: 4, x: 10, z: 5, y: 0, width: 5, bankLeft: 0, bankRight: 12 },
  { id: 5, x: 8, z: 9, y: 0, width: 6, bankLeft: 0, bankRight: 0 },
]

function iso (x: number, z: number, height = 0) {
  return { x: ORIGIN_X + (x - z) * CELL / 2, y: ORIGIN_Y + (x + z) * CELL / 4 - height * 10 }
}

function curvePath (points: Point[]) {
  if (points.length < 2)
    return ''

  const screen = points.map(point => iso(point.x, point.z, point.y))
  return screen.reduce((path, point, index) => {
    if (!index)
      return `M ${point.x} ${point.y}`

    const previous = screen[index - 1]
    const before   = screen[index - 2] ?? previous
    const after    = screen[index + 1] ?? point
    return `${path} C ${previous.x + (point.x - before.x) / 6} ${previous.y + (point.y - before.y) / 6}, ${point.x - (after.x - previous.x) / 6} ${point.y - (after.y - previous.y) / 6}, ${point.x} ${point.y}`
  }, '')
}

export function MapEditor () {
  const [ kind, setKind ]         = useState<MapKind>('race')
  const [ tool, setTool ]         = useState<Tool>('select')
  const [ route, setRoute ]       = useState(initialRoute)
  const [ selected, setSelected ] = useState(2)
  const [ heights, setHeights ]   = useState<number[]>(() => Array(SIZE * SIZE).fill(0))
  const [ placed, setPlaced ]     = useState<Placed[]>([{ id: 1, x: 3, z: 3, kind: 'Cargo stack' }, { id: 2, x: 8, z: 7, kind: 'Control point', team: 'Neutral' }, { id: 3, x: 2, z: 9, kind: 'Spawn', team: 'Cyan' }])
  const [ propKind, setPropKind ] = useState(PROPS[0])
  const [ team, setTeam ]         = useState(TEAMS[1])
  const [ testing, setTesting ]   = useState(false)
  const activePoint               = route.find(point => point.id === selected)
  const activePlaced              = placed.find(item => item.id === selected)
  const path                      = useMemo(() => curvePath(route), [ route ])
  const averageWidth              = route.reduce((total, point) => total + point.width, 0) / route.length * 7
  const averageRounding           = route.reduce((total, point) => total + point.bankLeft + point.bankRight, 0) / route.length / 18

  function switchKind (next: MapKind) {
    setKind(next); setTool(next === 'race' ? 'select' : 'prop'); setSelected(next === 'race' ? route[0].id : placed[0]?.id ?? 0); setTesting(false)
  }

  function gridPosition (event: PointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    const sx     = (event.clientX - bounds.left) * 860 / bounds.width
    const sy     = (event.clientY - bounds.top) * 520 / bounds.height
    const a      = (sx - ORIGIN_X) / (CELL / 2)
    const b      = (sy - ORIGIN_Y) / (CELL / 4)
    return { x: Math.max(0, Math.min(SIZE, (a + b) / 2)), z: Math.max(0, Math.min(SIZE, (b - a) / 2)) }
  }

  function editCanvas (event: PointerEvent<SVGSVGElement>) {
    if ((event.target as Element).closest('[data-item]'))
      return

    const point = gridPosition(event)
    if (kind === 'race' && tool === 'route') {
      const id = Date.now(); setRoute(current => [ ...current, { id, ...point, y: 0, width: 6, bankLeft: 0, bankRight: 0 }]); setSelected(id)
    }
    if (kind === 'battle') {
      const x = Math.min(SIZE - 1, Math.floor(point.x)); const z = Math.min(SIZE - 1, Math.floor(point.z))
      if (tool === 'raise' || tool === 'lower') {
        const index = z * SIZE + x
        setHeights(current => current.map((height, at) => at === index ? Math.max(-2, Math.min(5, height + (tool === 'raise' ? 1 : -1))) : height))
      }
      else if (tool === 'prop' || tool === 'control' || tool === 'spawn') {
        const id = Date.now(); const item = { id, x: x + 0.5, z: z + 0.5, kind: tool === 'prop' ? propKind : tool === 'control' ? 'Control point' : 'Spawn', team: tool === 'prop' ? undefined : team }
        setPlaced(current => [ ...current, item ]); setSelected(id)
      }
    }
  }

  function updatePoint (key: keyof Point, value: number) {
    setRoute(current => current.map(point => point.id === selected ? { ...point, [key]: value } : point))
  }
  function exportMap () {
    const data = kind === 'race' ? { version: 1, type: kind, route } : { version: 1, type: kind, terrain: heights, size: SIZE, objects: placed }
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([ JSON.stringify(data, null, 2) ], { type: 'application/json' })); link.download = `crash-velocity-${kind}-map.json`; link.click(); URL.revokeObjectURL(link.href)
  }

  const tools: { id: Tool, label: string, icon: string }[] = kind === 'race' ? [{ id: 'select', label: 'Select', icon: '⌖' }, { id: 'route', label: 'Bezier route', icon: '⌁' }] : [{ id: 'select', label: 'Select', icon: '⌖' }, { id: 'raise', label: 'Raise', icon: '▲' }, { id: 'lower', label: 'Lower', icon: '▼' }, { id: 'prop', label: 'Props', icon: '▣' }, { id: 'control', label: 'Control', icon: '◎' }, { id: 'spawn', label: 'Spawn', icon: '◆' }]

  return <main className={ styles.editor }>
    <header className={ styles.topbar }>
      <div className={ styles.brand }>
        <span>CV</span>

        <div>
          <strong>MAP FORGE</strong>
          <small>Industrial environment compiler</small>
        </div>
      </div>

      <div className={ styles.modeSwitch }>
        <button className={ kind === 'race' ? styles.active : '' } onClick={ () => switchKind('race') }>Race circuit</button>
        <button className={ kind === 'battle' ? styles.active : '' } onClick={ () => switchKind('battle') }>Battle arena</button>
      </div>

      <div className={ styles.actions }>
        <Link href="/">Exit</Link>
        <button onClick={ exportMap }>Export JSON</button>
        <button className={ styles.test } onClick={ () => setTesting(value => !value) }>{testing ? '■ Stop run' : '▶ Test run'}</button>
      </div>
    </header>

    <aside className={ styles.toolbar } aria-label="Editor tools">{tools.map(item => <button key={ item.id } title={ item.label } aria-label={ item.label } className={ tool === item.id ? styles.selectedTool : '' } onClick={ () => setTool(item.id) }>
      <b>{item.icon}</b>
      <span>{item.label}</span>
    </button>)}
    </aside>

    <section className={ styles.viewport }>
      <div className={ styles.viewportLabel }>
        <span>{kind === 'race' ? 'CIRCUIT_01' : 'ARENA_01'}</span>
        <small>ISO / GRID 1M</small>
      </div>

      <svg viewBox="0 0 860 520" role="img" aria-label={ `${kind} map isometric editor` } onPointerDown={ editCanvas }>
        <defs>
          <linearGradient id="ground" x2="0" y2="1">
            <stop stopColor="#15232b" />
            <stop offset="1" stopColor="#091216" />
          </linearGradient>

          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="blur" />

            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <polygon points={ `${iso(0, 0).x},${iso(0, 0).y} ${iso(SIZE, 0).x},${iso(SIZE, 0).y} ${iso(SIZE, SIZE).x},${iso(SIZE, SIZE).y} ${iso(0, SIZE).x},${iso(0, SIZE).y}` } fill="url(#ground)" stroke="#315260" />

        {Array.from({ length: SIZE + 1 }, (_, i) => <g key={ i } opacity=".32">
          <line x1={ iso(i, 0).x } y1={ iso(i, 0).y } x2={ iso(i, SIZE).x } y2={ iso(i, SIZE).y } />
          <line x1={ iso(0, i).x } y1={ iso(0, i).y } x2={ iso(SIZE, i).x } y2={ iso(SIZE, i).y } />
        </g>)}

        {kind === 'battle' && heights.map((height, index) => {
          if (!height)
            return null

          const x = index % SIZE; const z = Math.floor(index / SIZE); const corners = [[ x, z ], [ x + 1, z ], [ x + 1, z + 1 ], [ x, z + 1 ]].map(([ cx, cz ]) => iso(cx, cz, height)); return <polygon key={ index } points={ corners.map(p => `${p.x},${p.y}`).join(' ') } fill={ height > 0 ? '#20414a' : '#381e35' } stroke="#55dce9" opacity=".9" />
        })}

        {kind === 'race' && <g>
          <path d={ path } className={ styles.trackEdge } strokeWidth={ averageWidth + 6 + averageRounding } />
          <path d={ path } className={ styles.track } strokeWidth={ averageWidth } />
          <path d={ path } className={ styles.centreLine } />

          {route.map((point, index) => {
            const screen = iso(point.x, point.z, point.y); return <g
              data-item key={ point.id } className={ styles.node }
              onPointerDown={ event => {
                event.stopPropagation(); setSelected(point.id); setTool('select')
              } }>
              <circle cx={ screen.x } cy={ screen.y } r={ selected === point.id ? 10 : 7 } />
              <text x={ screen.x } y={ screen.y + 3 }>{String(index + 1).padStart(2, '0')}</text>
              {point.y !== 0 && <line x1={ screen.x } y1={ screen.y } x2={ iso(point.x, point.z).x } y2={ iso(point.x, point.z).y } className={ styles.heightLine } />}
            </g>
          })}

          {testing && <circle r="7" className={ styles.runner }>
            <animateMotion dur="5s" repeatCount="indefinite" path={ path } />
          </circle>}
        </g>}

        {kind === 'battle' && placed.map(item => {
          const height = heights[Math.floor(item.z) * SIZE + Math.floor(item.x)] ?? 0; const screen = iso(item.x, item.z, height); const control = item.kind === 'Control point'; const spawn = item.kind === 'Spawn'; return <g
            data-item key={ item.id } className={ `${styles.object} ${selected === item.id ? styles.objectSelected : ''}` }
            transform={ `translate(${screen.x} ${screen.y})` } onPointerDown={ event => {
              event.stopPropagation(); setSelected(item.id); setTool('select')
            } }>
            <ellipse rx="17" ry="8" />
            <path d={ control ? 'M -12 0 A 12 12 0 1 0 12 0 A 12 12 0 1 0 -12 0' : spawn ? 'M 0 -16 L 14 5 L 0 12 L -14 5 Z' : 'M -12 -19 L 10 -13 L 13 3 L -10 10 Z' } />
            <text y="28">{control ? 'CP' : spawn ? item.team?.slice(0, 1) : item.kind.split(' ')[0]}</text>
          </g>
        })}
      </svg>

      <div className={ styles.hint }>{tool === 'route' ? 'Click the grid to extend the spline' : tool === 'select' ? 'Select an item to inspect its parameters' : `Click a grid cell to ${tool}`}</div>

      <div className={ styles.zoom }>
        −
        <span>72%</span>
        {' '}
        +
      </div>
    </section>

    <aside className={ styles.inspector }>
      <div className={ styles.panelTitle }>
        <span>INSPECTOR</span>
        <small>{kind.toUpperCase()} MAP</small>
      </div>

      {kind === 'race' && activePoint && <>
        <h2>Route node {route.findIndex(point => point.id === selected) + 1}</h2>
        <p className={ styles.help }>Bezier handles are smoothed between nodes. Width and side curvature are evenly tweened along each segment.</p>
        <Slider label="Track width" value={ activePoint.width } min={ 3 } max={ 12 } unit="m" onChange={ value => updatePoint('width', value) } />
        <Slider label="Elevation" value={ activePoint.y } min={ -2 } max={ 12 } unit="m" onChange={ value => updatePoint('y', value) } />
        <Slider label="Left wall rounding" value={ activePoint.bankLeft } min={ 0 } max={ 90 } unit="°" onChange={ value => updatePoint('bankLeft', value) } />
        <Slider label="Right wall rounding" value={ activePoint.bankRight } min={ 0 } max={ 90 } unit="°" onChange={ value => updatePoint('bankRight', value) } />

        <div className={ styles.readout }>
          <span>Interpolation</span>
          <strong>Even / cubic</strong>
          <span>Segment length</span>
          <strong>42.8 m</strong>
        </div>

        <button
          className={ styles.delete } disabled={ route.length <= 2 } onClick={ () => {
            setRoute(current => current.filter(point => point.id !== selected)); setSelected(route[0].id)
          } }>Delete node
        </button>
      </>}

      {kind === 'race' && !activePoint && <p className={ styles.empty }>Select a route node to edit track geometry.</p>}

      {kind === 'battle' && <>
        <h2>{activePlaced ? activePlaced.kind : 'Placement palette'}</h2>

        <label className={ styles.field }>
          Industrial prop
          <select value={ propKind } onChange={ event => setPropKind(event.target.value) }>{PROPS.map(item => <option key={ item }>{item}</option>)}</select>
        </label>

        <label className={ styles.field }>
          Team attribute
          <select
            value={ activePlaced?.team ?? team } onChange={ event => {
              setTeam(event.target.value); setPlaced(current => current.map(item => item.id === selected ? { ...item, team: event.target.value } : item))
            } }>{TEAMS.map(item => <option key={ item }>{item}</option>)}
          </select>
        </label>

        <div className={ styles.palette }>{PROPS.map((item, index) => <button
          key={ item } onClick={ () => {
            setPropKind(item); setTool('prop')
          } }>
          <b>{[ '▤', '◉', '⬡', '⌘' ][index]}</b>
          <span>{item}</span>
        </button>)}
        </div>

        <div className={ styles.readout }>
          <span>Ground range</span>
          <strong>−2 — 5 m</strong>
          <span>Grid resolution</span>
          <strong>{SIZE} × {SIZE}</strong>
          <span>Placed objects</span>
          <strong>{placed.length}</strong>
        </div>

        {activePlaced && <button
          className={ styles.delete } onClick={ () => {
            setPlaced(current => current.filter(item => item.id !== selected)); setSelected(0)
          } }>Remove object
        </button>}
      </>}
    </aside>

    <footer className={ styles.status }>
      <span>
        <i />
        {' '}
        AUTOSAVE READY
      </span>

      <span>{kind === 'race' ? `${route.length} ROUTE NODES` : `${placed.length} OBJECTS · ${heights.filter(Boolean).length} MODIFIED TILES`}</span>
      <span>SNAP 1.0 M</span>
    </footer>
  </main>
}

type SliderProps = { label: string, value: number, min: number, max: number, unit: string, onChange: (value:number) => void }

function Slider ({ label, value, min, max, unit, onChange }:SliderProps) {
  return <label className={ styles.slider }>
    <span>
      {label}
      <output>{value}{unit}</output>
    </span>

    <input type="range" min={ min } max={ max } value={ value } onChange={ event => onChange(Number(event.target.value)) } />

    <small>
      {min}
      {unit}
      <b>{max}{unit}</b>
    </small>
  </label>
}
