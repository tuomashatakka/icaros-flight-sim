import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { TEAM_COLORS } from 'Ψarena'
import { WEAPONS } from 'Ψweapons'
import { HudPanel } from './panel'
import {
  drawHeadingTape,
  drawPitchLadder,
  drawTabularNumber,
  headingFrom,
  pitchFrom,
  rollFrom,
  surfaceAlignment,
} from './instruments'
import { formatHudClock, formatHudRaceTime } from './interaction'
import { createHudFacetMaterial, createHudGlassMaterial } from './materials'
import type { HudFacetMaterial, HudGlassMaterial } from './materials'
import { hudVisorPoint, HUD_PANEL_TRACES, HUD_VISOR_FACETS, HUD_VISOR_SURFACE } from './layout'
import type { HudPanelTrace, HudVisorCorners, HudVisorFacet } from './layout'
import { drawCornerBrackets, drawSegmentedBar, drawTrackedText } from './chrome'
import {
  HUD_BAR_SEGMENTS,
  HUD_BOOST_CRITICAL,
  HUD_HUES as HUES,
  HUD_PALE as PALE,
  HUD_PANEL_ACCENTS as ACCENTS,
  HUD_THEME as THEME,
} from './tokens'
import type { BattleHudData, HudData, HudFrame, HudPanelKey, RaceHudData } from './types'


const quantise = (value: number, step = 0.02) => Math.round(value / step)

/** Absolute compass bearing from `from` to `to`, matching `headingFrom`'s convention. */
function bearingTo (from: THREE.Vector3, to: THREE.Vector3): number {
  return (Math.atan2(to.x - from.x, to.z - from.z) * THREE.MathUtils.RAD2DEG + 360) % 360
}

/** Values are deliberately quantised at their displayed precision. */
function panelRenderKey (panel: HudPanel, data: HudData, frame: HudFrame): string {
  const pose   = [ quantise(pitchFrom(frame.hullQuaternion), 1), quantise(rollFrom(frame.hullQuaternion), 1) ]
  const common = [ data.mode, panel.name, frame.cameraBlend > 0.5, panel.hovered ]
  if (panel.name === 'topCenter') {
    // The heading tape and its bearing caret are new instruments here — both
    // must gate the redraw or the tape freezes while the hull keeps turning.
    const heading = quantise(headingFrom(frame.hullQuaternion), 1)
    const bearing = frame.target ? quantise(bearingTo(frame.shipPosition, frame.target), 1) : null
    const status  = data.mode === 'race'
      ? [ data.race.status, data.race.linkError, quantise(data.clocks.countdown, 1), frame.telemetry.boosting ]
      : [ data.battle.status, quantise(data.battle.countdown, 1), quantise(data.battle.timeLeft, 1), data.battle.net.linkError, data.battle.net.synced, data.battle.net.rttMs, data.battle.net.jitterMs ]
    return [ ...common, ...status, ...pose, heading, bearing, quantise(frame.aimPitch, 0.01), quantise(frame.steer, 0.01), quantise(frame.strafe, 0.01) ].join('|')
  }

  if (data.mode === 'race') {
    const race                               = data.race
    const distance                           = frame.target ? frame.shipPosition.distanceTo(frame.target) : 0
    const telemetry                          = frame.telemetry
    const byPanel: Record<string, unknown[]> = {
      topLeft:      [ frame.targetLabel, frame.checkpointNumber, frame.checkpointCount, quantise(gateClosure(frame), 0.01) ],
      topRight:     [ frame.targetLabel, frame.checkpointNumber, quantise(distance, 1), quantise(telemetry.speed * 3.6, 1), quantise(gateClosure(frame), 0.01), data.tuningOpen ],
      bottomLeft:   [ quantise(surfaceAlignment(frame.hullQuaternion), 0.01), quantise(telemetry.boostMeter, 0.01), telemetry.grounded, quantise(telemetry.gLoad, 0.1), quantise(telemetry.airbrake, 0.01), telemetry.crashSeq ],
      bottomCenter: [ quantise(frame.throttle, 0.01), quantise(telemetry.boostMeter, 0.01), quantise(telemetry.speed * 3.6, 1), quantise(telemetry.velocity.y, 0.1), telemetry.boosting ],
      bottomRight:  [ race.currentLap, race.laps, frame.checkpointNumber, quantise(data.clocks.lapElapsed, 0.001), data.zone, data.shipId, quantise(telemetry.speed / Math.max(data.targetSpeed, 1), 0.01), data.tuningOpen ],
      center:       [ race.currentLap, race.laps, quantise(data.clocks.elapsed, 0.001), race.bestLap, telemetry.boosting ],
    }
    return [ ...common, race.status, race.linkError, ...byPanel[panel.name] ].join('|')
  }

  const battle                             = data.battle
  const byPanel: Record<string, unknown[]> = {
    topLeft:      [ battle.scores.red, battle.scores.blue, battle.scoreTarget, ...battle.zones.flatMap(zone => [ zone.owner, zone.capturing, quantise(zone.progress, 0.01), zone.contested ]) ],
    topRight:     [ battle.lockOn.phase, battle.lockOn.name, quantise(battle.lockOn.progress, 0.01), quantise(frame.sight?.range ?? battle.lockOn.distance, 1), battle.lockOn.targetId ],
    bottomLeft:   [ battle.myHealth, battle.maxHealth, quantise(battle.myBoost, 0.01), battle.myKills, battle.myDeaths, battle.carrying ],
    bottomCenter: [ quantise(frame.throttle, 0.01), quantise(battle.myBoost, 0.01), quantise(frame.telemetry.speed * 3.6, 1), quantise(frame.telemetry.gLoad, 0.1), battle.myBoost < 0.15, frame.telemetry.boosting ],
    bottomRight:  [ battle.primary?.id, quantise(battle.primary?.cooldown ?? 0, 0.01), battle.secondary?.id, quantise(battle.secondary?.cooldown ?? 0, 0.01), battle.lockOn.phase, battle.carrying ],
    center:       [ battle.myName, battle.myTeam, battle.scores.red, battle.scores.blue, quantise(battle.timeLeft, 1), battle.primary?.id ],
  }
  return [ ...common, battle.status, quantise(battle.countdown, 1), ...byPanel[panel.name] ].join('|')
}

function renderPanel (panel: HudPanel, data: HudData, frame: HudFrame, draw: () => void): void {
  panel.render(panelRenderKey(panel, data, frame), frame.elapsed, draw)
}

export function createHudPanels (): Record<HudPanelKey, HudPanel> {
  return {
    topLeft:      new HudPanel({ name: 'topLeft', title: 'navigation', accent: ACCENTS.topLeft, trace: HUD_PANEL_TRACES.topLeft }),
    topCenter:    new HudPanel({ name: 'topCenter', title: 'attitude', accent: ACCENTS.topCenter, trace: HUD_PANEL_TRACES.topCenter }),
    topRight:     new HudPanel({ name: 'topRight', title: 'target', accent: ACCENTS.topRight, trace: HUD_PANEL_TRACES.topRight }),
    center:       new HudPanel({ name: 'center', width: 560, height: 560, center: true, accent: ACCENTS.center }),
    bottomLeft:   new HudPanel({ name: 'bottomLeft', title: 'defense', accent: ACCENTS.bottomLeft, trace: HUD_PANEL_TRACES.bottomLeft }),
    bottomCenter: new HudPanel({ name: 'bottomCenter', title: 'propulsion', accent: ACCENTS.bottomCenter, trace: HUD_PANEL_TRACES.bottomCenter }),
    bottomRight:  new HudPanel({ name: 'bottomRight', title: 'power', accent: ACCENTS.bottomRight, trace: HUD_PANEL_TRACES.bottomRight }),
  }
}

export function createHudPanelMesh (panels: Record<HudPanelKey, HudPanel>): THREE.Mesh {
  const geometries: THREE.BufferGeometry[] = []
  const materials: HudFacetMaterial[]      = []
  const indexToKey: HudPanelKey[]          = []

  for (const definition of HUD_VISOR_FACETS) {
    const geometry = createPanelGeometry(definition)
    geometries.push(geometry)

    const panel    = panels[definition.key]
    const material = createHudFacetMaterial({
      map:    panel.texture,
      accent: panel.accent,
    })
    materials.push(material)
    indexToKey.push(definition.key)
  }

  const merged = mergeGeometries(geometries, true)
  for (const geometry of geometries)
    geometry.dispose()
  if (!merged)
    throw new Error('failed to merge spatial hud facets')

  const mesh                 = new THREE.Mesh(merged, materials)
  mesh.name                  = 'spatial-cockpit-hud-seven-facets'
  mesh.renderOrder           = 1000
  mesh.frustumCulled         = false
  mesh.userData.panels       = indexToKey
  mesh.userData.hudMaterials = materials

  const backingParts    = HUD_VISOR_SURFACE.map(createSurfaceGeometry)
  const backingGeometry = mergeGeometries(backingParts, false)
  for (const geometry of backingParts)
    geometry.dispose()
  if (!backingGeometry)
    throw new Error('failed to merge spatial hud backing')

  const backingMaterial = createHudGlassMaterial()
  const backing         = new THREE.Mesh(backingGeometry, backingMaterial)
  backing.name          = 'spatial-cockpit-hud-continuous-glass'
  backing.renderOrder   = 999
  backing.frustumCulled = false
  backing.raycast       = () => {}
  mesh.add(backing)
  mesh.userData.glassMaterial = backingMaterial
  return mesh
}

function createPanelGeometry (definition: HudVisorFacet): THREE.BufferGeometry {
  if (!definition.trace)
    return createSurfaceGeometry(definition.corners)

  const geometry            = new THREE.BufferGeometry()
  const positions: number[] = []
  const uvs: number[]       = []
  const points              = definition.trace.contour.map(([ u, v ]) => new THREE.Vector2(u, v))
  for (const point of points) {
    const x = THREE.MathUtils.lerp(definition.corners[0][0], definition.corners[1][0], point.x)
    const y = THREE.MathUtils.lerp(definition.corners[0][1], definition.corners[2][1], point.y)
    positions.push(...hudVisorPoint(x, y))
    uvs.push(point.x, point.y)
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(THREE.ShapeUtils.triangulateShape(points, []).flat())
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

function createSurfaceGeometry (corners: HudVisorCorners): THREE.BufferGeometry {
  const segments            = 5
  const left                = corners[0][0]
  const right               = corners[1][0]
  const bottom              = corners[0][1]
  const top                 = corners[2][1]
  const positions: number[] = []
  const uvs: number[]       = []
  const indices: number[]   = []

  for (let row = 0; row <= segments; row++) {
    const v = row / segments
    const y = THREE.MathUtils.lerp(bottom, top, v)
    for (let column = 0; column <= segments; column++) {
      const u = column / segments
      const x = THREE.MathUtils.lerp(left, right, u)
      positions.push(...hudVisorPoint(x, y))
      uvs.push(u, v)
    }
  }

  const stride = segments + 1
  for (let row = 0; row < segments; row++)
    for (let column = 0; column < segments; column++) {
      const a = row * stride + column
      const b = a + 1
      const c = a + stride
      const d = c + 1
      indices.push(a, b, c, c, b, d)
    }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

/**
 * @param reveal - 0..1 arrival phase. The facets are staggered across it, so
 * the visor assembles panel by panel instead of appearing as one sheet — which
 * is both better looking and how you can tell at a glance that a panel is late.
 */
export function tickHudPanelMesh (mesh: THREE.Mesh, elapsed: number, reveal = 1): void {
  const materials = mesh.userData.hudMaterials as HudFacetMaterial[]
  const glass     = mesh.userData.glassMaterial as HudGlassMaterial
  const stagger   = 0.45 / Math.max(1, materials.length - 1)

  materials.forEach((material, index) => {
    material.uniforms.uTime.value = elapsed

    // Compress each panel's own ramp into the window left after its delay, so
    // every one of them still finishes exactly when the reveal does.
    const delay                     = index * stagger
    material.uniforms.uReveal.value = Math.max(0, Math.min(1, (reveal - delay) / (1 - delay)))
  })
  glass.uniforms.uTime.value = elapsed
}

export function disposeHudPanelMesh (mesh: THREE.Mesh): void {
  for (const child of mesh.children)
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose()

      const materials = Array.isArray(child.material) ? child.material : [ child.material ]
      for (const material of materials)
        material.dispose()
    }

  const materials = Array.isArray(mesh.material) ? mesh.material : [ mesh.material ]
  for (const material of materials)
    material.dispose()
  mesh.geometry.dispose()
}

/**
 * The attitude panel's instrument: a heading tape above a pitch ladder.
 *
 * `frame.aimPitch` used to be passed here as "pitch". In race that is the raw
 * -1/0/+1 R/F key state, not an angle, so the horizon had three positions and
 * none of them was the hull's. The ladder reads the hull; the aim axis is a
 * separate caret, because a gun elevation and an attitude are different facts.
 */
function drawAttitude (
  panel: HudPanel,
  quaternion: THREE.Quaternion,
  aimPitch: number,
  bearingToTarget: number | null
): void {
  const heading = headingFrom(quaternion)
  const pitch   = pitchFrom(quaternion)
  const roll    = rollFrom(quaternion)

  drawHeadingTape(panel, {
    x:      panel.canvas.width * 0.5 - 190,
    y:      96,
    width:  380,
    height: 14,
    heading,
    bearingToTarget,
  })
  drawTrackedText(panel.context, `[ ${String(Math.round(heading) % 360).padStart(3, '0')}° ]`, panel.canvas.width * 0.5, 122, {
    align: 'center', color: panel.accent, size: 13, alpha: 0.9, glow: true,
  })

  drawPitchLadder(panel, {
    x:               panel.canvas.width * 0.5,
    y:               190,
    halfWidth:       170,
    halfHeight:      64,
    pitch,
    roll,
    pixelsPerDegree: 3.2,
  })

  // Commanded gun elevation, on its own tape beside the ladder — this is the
  // one thing `aimPitch` legitimately says.
  const { context } = panel
  const trackX      = panel.canvas.width * 0.5 + 200
  context.save()
  context.strokeStyle = THEME.dim
  context.lineWidth   = 2
  context.beginPath()
  context.moveTo(trackX, 130)
  context.lineTo(trackX, 250)
  context.stroke()
  context.fillStyle   = panel.accent
  context.globalAlpha = 0.9

  const caretY        = 190 - THREE.MathUtils.clamp(aimPitch, -1, 1) * 58
  context.beginPath()
  context.moveTo(trackX - 11, caretY)
  context.lineTo(trackX - 2, caretY - 6)
  context.lineTo(trackX - 2, caretY + 6)
  context.closePath()
  context.fill()
  context.restore()

  panel.text({ x: 36, y: 268, size: 12, alpha: 0.55, value: `PITCH ${pitch >= 0 ? '+' : ''}${Math.round(pitch)}° · BANK ${roll >= 0 ? '+' : ''}${Math.round(roll)}°` })
}

/** A row of gate ticks: the next one gets a bracketed cyan gate glyph. */
function drawTrackRibbon (panel: HudPanel, total: number, next: number): void {
  const { context } = panel
  const count       = Math.max(1, total)
  const gap         = 5
  const width       = (390 - gap * (count - 1)) / count

  for (let i = 0; i < count; i++) {
    const x          = 36 + i * (width + gap)
    const isNext     = i === next
    const isComplete = i < next
    const color      = isNext ? THEME.accent : isComplete ? THEME.primary : THEME.dimmer

    if (isNext)
      drawCornerBrackets(context, { x: x - 5, y: 214, width: width + 10, height: 30 }, THEME.accent, { len: 8, inset: 0, width: 1.5, alpha: 0.85 })

    context.fillStyle   = color
    context.globalAlpha = isNext ? 0.95 : isComplete ? 0.7 : 0.32
    context.fillRect(x, isNext ? 220 : 224, width, isNext ? 18 : 12)
  }
  context.globalAlpha = 1

  drawTrackedText(context, `NEXT ${Math.min(next + 1, count)} / ${count} GATES`, 36, 266, { size: 11, color: THEME.pale, alpha: 0.6, tracking: 1.4 })
}

function drawZonePips (panel: HudPanel, data: BattleHudData): void {
  const { context } = panel
  const zones       = data.battle.zones
  const width       = 58
  const gap         = 12
  const startX      = 38

  zones.slice(0, 7).forEach((zone, index) => {
    const x     = startX + index * (width + gap)
    const color = zone.owner
      ? TEAM_COLORS[zone.owner]
      : zone.capturing
        ? TEAM_COLORS[zone.capturing]
        : THEME.dim
    const fill          = Math.max(0, Math.min(1, zone.progress))
    context.strokeStyle = THEME.dim
    context.lineWidth   = 1
    context.globalAlpha = 0.5
    context.strokeRect(x, 210, width, 52)
    context.globalAlpha = 1
    context.fillStyle   = `${color}44`
    context.fillRect(x, 210 + 52 * (1 - fill), width, 52 * fill)
    context.strokeStyle = zone.contested ? THEME.red : color
    context.lineWidth   = zone.contested ? 3 : 2
    context.strokeRect(x, 210, width, 52)
    drawTrackedText(context, zone.short, x + width * 0.5, 236, { align: 'center', color, size: 14, alpha: 0.9, tracking: 0.5 })
  })
}

/** The one line at the top of the visor. */
function raceStatusLine (data: RaceHudData, boosting: boolean): string {
  const race = data.race
  // Free flight, not a dead ship: with no room to hold the grid the prediction
  // drives unconditionally (see the `racing` policy in `mountRace`). The detail
  // line under this one names the server that could not be reached.
  if (race.linkError)
    return 'NO LINK · FREE FLIGHT'
  if (race.status === 'countdown')
    return `LAUNCH · ${Math.max(1, Math.ceil(data.clocks.countdown))}`
  if (race.status === 'finished')
    return 'COURSE COMPLETE'
  return boosting ? 'BOOST · FLIGHT' : 'CRUISE · FLIGHT'
}

/** A holographic bracket frame around a target readout's name/distance block. */
function drawTargetFrame (panel: HudPanel, color: string): void {
  drawCornerBrackets(panel.context, { x: 22, y: 78, width: 596, height: 96 }, color, { len: 16, inset: 2, width: 1.6, alpha: 0.7 })
}

function drawRacePanels (panels: Record<HudPanelKey, HudPanel>, data: RaceHudData, frame: HudFrame): void {
  const race               = data.race
  const telemetry          = frame.telemetry
  const targetDistance     = frame.target ? frame.shipPosition.distanceTo(frame.target) : 0
  const bearingToTarget    = frame.target ? bearingTo(frame.shipPosition, frame.target) : null
  const view               = frame.cameraBlend > 0.5 ? 'COCKPIT' : 'CHASE'
  const upness             = surfaceAlignment(frame.hullQuaternion)
  const targetClosure      = gateClosure(frame)
  const checkpointProgress = frame.checkpointCount > 0
    ? frame.checkpointNumber / frame.checkpointCount
    : 0
  const courseProgress = race.loop
    ? (race.currentLap - 1 + checkpointProgress) / Math.max(race.laps, 1)
    : checkpointProgress
  const speedRatio = telemetry.speed / Math.max(data.targetSpeed, 1)

  const topLeft = panels.topLeft
  topLeft.title = 'navigation'
  renderPanel(topLeft, data, frame, () => {
    drawTrackedText(topLeft.context, `[ GATE ${frame.checkpointNumber}/${Math.max(frame.checkpointCount, 1)} ]`, 36, 92, { size: 18, color: topLeft.accent, glow: true })
    topLeft.text({ x: 36, y: 122, size: 14, alpha: 0.6, value: frame.targetLabel || 'NO ROUTE VECTOR' })
    topLeft.bar({ x: 36, y: 172, width: 390, height: 14, label: 'gate closure', value: targetClosure, color: topLeft.accent })
    topLeft.button({ id: 'menu', x: 456, y: 90, width: 142, height: 44, label: 'menu', action: 'menu' })
    topLeft.button({ id: 'view', x: 456, y: 148, width: 142, height: 44, label: view, action: 'view', active: frame.cameraBlend > 0.5 })
    drawTrackRibbon(topLeft, frame.checkpointCount, Math.max(0, frame.checkpointNumber - 1))
  })

  const topCenter = panels.topCenter
  topCenter.title = 'attitude'
  renderPanel(topCenter, data, frame, () => {
    drawTrackedText(topCenter.context, raceStatusLine(data, telemetry.boosting), 320, 60, {
      align: 'center', color: race.linkError ? THEME.red : PALE.blue, size: 15, glow: true,
    })
    if (race.linkError)
      topCenter.text({ x: 320, y: 82, size: 12, align: 'center', alpha: 0.7, color: THEME.red, value: race.linkError })
    drawAttitude(topCenter, frame.hullQuaternion, frame.aimPitch, bearingToTarget)
    topCenter.text({ x: 36, y: 292, size: 12, alpha: 0.5, value: `TURN ${signedPercent(frame.steer)} · STRAFE ${signedPercent(frame.strafe)} · AIM ${signedPercent(frame.aimPitch)}` })
    topCenter.button({ id: 'attitude-view', x: 500, y: 268, width: 108, height: 32, label: view, action: 'view', active: frame.cameraBlend > 0.5, size: 12 })
  })

  const topRight = panels.topRight
  topRight.title = 'target'
  renderPanel(topRight, data, frame, () => {
    drawTargetFrame(topRight, topRight.accent)
    topRight.text({ x: 36, y: 98, size: 19, color: PALE.magenta, value: frame.target ? `GATE ${frame.checkpointNumber} · ${frame.targetLabel}` : 'NO ROUTE TARGET' })
    topRight.text({ x: 36, y: 132, size: 15, alpha: 0.62, value: `RANGE ${Math.round(targetDistance)} m · SPEED ${Math.round(telemetry.speed * 3.6)} km/h` })
    topRight.bar({ x: 36, y: 176, width: 390, height: 14, label: 'gate closure', value: targetClosure, color: topRight.accent })
    topRight.button({ id: 'respawn', x: 456, y: 90, width: 142, height: 44, label: 'respawn', action: 'respawn', color: THEME.red })
    topRight.button({ id: 'tuning', x: 456, y: 148, width: 142, height: 44, label: 'tuning', action: 'tuning-toggle', active: data.tuningOpen })
  })

  const bottomLeft = panels.bottomLeft
  // 'defense' was the battle panel's title worn by a mode with no hull model,
  // no shields and nothing to defend against — it showed airframe data under a
  // combat heading. Race calls it what it is.
  bottomLeft.title = 'airframe'
  renderPanel(bottomLeft, data, frame, () => {
    bottomLeft.bar({ x: 36, y: 104, width: 404, height: 16, label: 'surface alignment', value: upness, color: bottomLeft.accent })
    drawSegmentedBar(bottomLeft.context, { x: 36, y: 170, width: 404, height: 18 }, telemetry.boostMeter, {
      color:         HUES.green,
      criticalColor: THEME.red,
      criticalBelow: HUD_BOOST_CRITICAL,
      segments:      HUD_BAR_SEGMENTS,
      label:         'boost reserve',
      valueLabel:    `${Math.round(telemetry.boostMeter * 100)}%`,
    })
    bottomLeft.text({ x: 36, y: 246, size: 14, alpha: 0.6, value: `${telemetry.grounded ? 'SURFACE LOCK' : 'AIRBORNE'} · ${telemetry.gLoad.toFixed(1)}G · AIRBRAKE ${Math.round(telemetry.airbrake * 100)}% · IMPACTS ${telemetry.crashSeq}` })
    bottomLeft.button({ id: 'defense-reset', x: 466, y: 120, width: 132, height: 52, label: 'reset', action: 'respawn' })
  })

  const bottomCenter = panels.bottomCenter
  bottomCenter.title = 'propulsion'
  renderPanel(bottomCenter, data, frame, () => {
    drawSegmentedBar(bottomCenter.context, { x: 36, y: 96, width: 34, height: 172 }, frame.throttle, {
      color: bottomCenter.accent, vertical: true, segments: HUD_BAR_SEGMENTS, label: 'thr',
    })
    drawSegmentedBar(bottomCenter.context, { x: 88, y: 96, width: 34, height: 172 }, telemetry.boostMeter, {
      color: HUES.green, criticalColor: THEME.red, criticalBelow: HUD_BOOST_CRITICAL, vertical: true, segments: HUD_BAR_SEGMENTS, label: 'bst',
    })

    const speedWidth = drawTabularNumber(bottomCenter.context, String(Math.round(telemetry.speed * 3.6)), 156, 140, { size: 46, color: THEME.pale, weight: 700, glow: true })
    bottomCenter.text({ x: 156 + speedWidth + 10, y: 148, size: 13, alpha: 0.55, value: 'KM/H' })
    bottomCenter.text({ x: 156, y: 178, size: 13, alpha: 0.5, value: `TARGET ${Math.round(data.targetSpeed * 3.6)} KM/H` })
    bottomCenter.text({ x: 156, y: 202, size: 13, alpha: 0.56, value: `CMD ${Math.round(frame.throttle * 100)}% · CLIMB ${telemetry.velocity.y >= 0 ? '+' : ''}${telemetry.velocity.y.toFixed(1)} m/s · ${telemetry.boosting ? 'BOOST ACTIVE' : 'CRUISE'}` })
    bottomCenter.button({ id: 'boost', x: 466, y: 116, width: 132, height: 54, label: 'boost', action: 'boost', kind: 'hold', active: telemetry.boosting })
  })

  const bottomRight = panels.bottomRight
  bottomRight.title = 'race systems'
  renderPanel(bottomRight, data, frame, () => {
    bottomRight.bar({ x: 36, y: 104, width: 404, height: 16, label: 'course', value: courseProgress, color: bottomRight.accent })
    bottomRight.bar({ x: 36, y: 170, width: 404, height: 16, label: `zone ${data.zone} target`, value: speedRatio, color: PALE.amber })
    drawTrackedText(bottomRight.context, `[ LAP ${race.loop ? `${Math.min(race.currentLap, race.laps)}/${race.laps}` : 'SPRINT'} ]`, 36, 230, { size: 14, color: bottomRight.accent, glow: true })
    bottomRight.text({ x: 200, y: 230, size: 13, alpha: 0.6, value: `${data.shipId.toUpperCase()} · ZONE ${data.zone}` })
    drawTabularNumber(bottomRight.context, formatHudRaceTime(data.clocks.lapElapsed), 36, 258, { size: 20, color: THEME.pale, weight: 700 })
    bottomRight.button({ id: 'race-tuning', x: 466, y: 120, width: 132, height: 52, label: 'tune', action: 'tuning-toggle', active: data.tuningOpen })
  })

  // No reticle here any more: the sight has to sit at a screen position and
  // this facet is a surface in the world — see `hud/sight.ts`.
  const center = panels.center
  renderPanel(center, data, frame, () => {
    drawTrackedText(center.context, `[ LAP ${race.loop ? `${Math.min(race.currentLap, race.laps)}/${race.laps}` : 'SPRINT'} ]`, 280, 428, { align: 'center', size: 14, color: center.accent, alpha: 0.85, glow: true })
    drawTabularNumber(center.context, formatHudRaceTime(data.clocks.elapsed), 280, 454, { size: 18, color: THEME.pale, weight: 600, align: 'center' })
    center.text({ x: 280, y: 480, align: 'center', size: 12, alpha: 0.48, value: race.bestLap === null ? 'BEST --:--.---' : `BEST ${formatHudRaceTime(race.bestLap)}` })
    center.button({ id: 'center-boost', x: 208, y: 500, width: 144, height: 36, label: 'hold boost', action: 'boost', kind: 'hold', active: telemetry.boosting, size: 12 })
  })
}

function drawBattlePanels (panels: Record<HudPanelKey, HudPanel>, data: BattleHudData, frame: HudFrame): void {
  const battle    = data.battle
  const locked    = battle.lockOn.phase === 'locked'
  const tracking  = battle.lockOn.phase === 'tracking'
  const lockColor = locked ? THEME.green : tracking ? THEME.accent : THEME.pale
  const health    = battle.myHealth / Math.max(1, battle.maxHealth)
  const target    = battle.roster.find(entry => entry.id === battle.lockOn.targetId)
  const scoreMax  = Math.max(1, battle.scoreTarget)

  const topLeft = panels.topLeft
  topLeft.title = 'tactical'
  renderPanel(topLeft, data, frame, () => {
    topLeft.text({ x: 36, y: 90, size: 18, color: TEAM_COLORS.red, value: `RED ${battle.scores.red}` })
    topLeft.text({ x: 210, y: 90, size: 14, color: TEAM_COLORS.blue, value: `BLUE ${battle.scores.blue} · FIRST TO ${battle.scoreTarget}` })
    drawSegmentedBar(topLeft.context, { x: 36, y: 118, width: 390, height: 14 }, battle.scores.red / scoreMax, { color: TEAM_COLORS.red, segments: HUD_BAR_SEGMENTS })
    drawSegmentedBar(topLeft.context, { x: 36, y: 138, width: 390, height: 14 }, battle.scores.blue / scoreMax, { color: TEAM_COLORS.blue, segments: HUD_BAR_SEGMENTS, reverse: true })
    topLeft.button({ id: 'battle-menu', x: 456, y: 90, width: 142, height: 44, label: 'menu', action: 'menu' })
    topLeft.button({ id: 'battle-view', x: 456, y: 148, width: 142, height: 44, label: frame.cameraBlend > 0.5 ? 'cockpit' : 'chase', action: 'view', active: frame.cameraBlend > 0.5 })
    drawZonePips(topLeft, data)
  })

  const topCenter = panels.topCenter
  topCenter.title = 'attitude'
  renderPanel(topCenter, data, frame, () => {
    const status = battle.status === 'countdown'
      ? `DEPLOY · ${Math.max(1, Math.ceil(battle.countdown))}`
      : battle.status === 'finished'
        ? 'MATCH OVER'
        : battle.status === 'live'
          ? `COMBAT · ${formatHudClock(battle.timeLeft)}`
          : battle.status.toUpperCase()
    drawTrackedText(topCenter.context, status, 320, 60, { align: 'center', color: topCenter.accent, size: 15, glow: true })
    drawAttitude(topCenter, frame.hullQuaternion, frame.aimPitch, frame.target ? bearingTo(frame.shipPosition, frame.target) : null)

    // NET reads real connection health now. It used to show a hash-match tally
    // from a verifier that compared the local sim against a hash the local sim
    // had just produced — it was pinned to OK by construction.
    const net = battle.net.linkError
      ? 'NO LINK'
      : battle.net.synced
        ? `${battle.net.rttMs}ms ±${battle.net.jitterMs}`
        : 'SYNCING'
    topCenter.text({ x: 36, y: 292, size: 12, alpha: 0.5, value: `TURN ${signedPercent(frame.steer)} · STRAFE ${signedPercent(frame.strafe)} · NET ${net}` })
    topCenter.button({ id: 'battle-attitude-view', x: 500, y: 268, width: 108, height: 32, label: frame.cameraBlend > 0.5 ? 'cockpit' : 'chase', action: 'view', active: frame.cameraBlend > 0.5, size: 12 })
  })

  const topRight = panels.topRight
  topRight.title = 'target'
  renderPanel(topRight, data, frame, () => {
    drawTargetFrame(topRight, lockColor)
    topRight.text({ x: 36, y: 98, size: 19, color: lockColor, value: locked ? `LOCKED · ${battle.lockOn.name?.toUpperCase() ?? 'TARGET'}` : tracking ? `ACQUIRING · ${battle.lockOn.name?.toUpperCase() ?? 'TARGET'}` : 'NO HARD LOCK' })
    topRight.text({ x: 36, y: 132, size: 15, alpha: 0.62, value: `RANGE ${Math.round(frame.sight && Number.isFinite(frame.sight.range) ? frame.sight.range : battle.lockOn.distance || 0)} m · ${target ? `${target.team.toUpperCase()} · K/D ${target.kills}/${target.deaths}` : 'NO CONTACT DATA'}` })
    topRight.bar({ x: 36, y: 176, width: 390, height: 14, label: 'lock signal', value: battle.lockOn.progress, color: lockColor })
    topRight.button({ id: 'battle-respawn', x: 456, y: 90, width: 142, height: 44, label: 'respawn', action: 'respawn', color: THEME.red })
    topRight.button({ id: 'battle-view-right', x: 456, y: 148, width: 142, height: 44, label: 'view', action: 'view' })
  })

  const bottomLeft = panels.bottomLeft
  bottomLeft.title = 'defense'
  renderPanel(bottomLeft, data, frame, () => {
    bottomLeft.bar({ x: 36, y: 104, width: 390, height: 16, label: 'hull', value: health, color: health < 0.3 ? THEME.red : bottomLeft.accent })
    drawSegmentedBar(bottomLeft.context, { x: 36, y: 170, width: 390, height: 16 }, battle.myBoost, {
      color:         HUES.green,
      criticalColor: THEME.red,
      criticalBelow: HUD_BOOST_CRITICAL,
      segments:      HUD_BAR_SEGMENTS,
      label:         'boost',
      valueLabel:    `${Math.round(battle.myBoost * 100)}%`,
    })
    bottomLeft.text({ x: 36, y: 246, size: 14, alpha: 0.6, value: `HULL ${battle.myHealth}/${battle.maxHealth} · K/D ${battle.myKills}/${battle.myDeaths}` })
    bottomLeft.button({ id: 'battle-defense-respawn', x: 466, y: 120, width: 132, height: 52, label: 'respawn', action: 'respawn' })
    bottomLeft.text({ x: 598, y: 246, size: 12, align: 'right', color: battle.carrying ? TEAM_COLORS[battle.carrying] : bottomLeft.accent, value: battle.carrying ? `${battle.carrying.toUpperCase()} CORE` : 'CORE BAY EMPTY' })
  })

  const bottomCenter = panels.bottomCenter
  bottomCenter.title = 'propulsion'
  renderPanel(bottomCenter, data, frame, () => {
    drawSegmentedBar(bottomCenter.context, { x: 36, y: 96, width: 34, height: 172 }, frame.throttle, {
      color: bottomCenter.accent, vertical: true, segments: HUD_BAR_SEGMENTS, label: 'thr',
    })
    drawSegmentedBar(bottomCenter.context, { x: 88, y: 96, width: 34, height: 172 }, battle.myBoost, {
      color: HUES.green, criticalColor: THEME.red, criticalBelow: HUD_BOOST_CRITICAL, vertical: true, segments: HUD_BAR_SEGMENTS, label: 'bst',
    })

    const speedWidth = drawTabularNumber(bottomCenter.context, String(Math.round(frame.telemetry.speed * 3.6)), 156, 140, { size: 46, color: THEME.pale, weight: 700, glow: true })
    bottomCenter.text({ x: 156 + speedWidth + 10, y: 148, size: 13, alpha: 0.55, value: 'KM/H' })
    bottomCenter.text({ x: 156, y: 178, size: 13, alpha: 0.56, value: `CMD ${Math.round(frame.throttle * 100)}% · ${frame.telemetry.gLoad.toFixed(1)}G` })
    bottomCenter.text({ x: 156, y: 202, size: 13, alpha: 0.6, color: battle.myBoost < 0.15 ? THEME.red : PALE.violet, value: battle.myBoost < 0.15 ? 'BOOST CRITICAL' : 'BOOST ARMED' })
    bottomCenter.button({ id: 'battle-boost', x: 466, y: 116, width: 132, height: 54, label: 'boost', action: 'boost', kind: 'hold', active: frame.telemetry.boosting })
  })

  const primary     = battle.primary
  const secondary   = battle.secondary
  const bottomRight = panels.bottomRight
  bottomRight.title = 'weapons'
  renderPanel(bottomRight, data, frame, () => {
    if (primary) {
      const weapon = WEAPONS[primary.id]
      drawSegmentedBar(bottomRight.context, { x: 36, y: 96, width: 350, height: 16 }, 1 - primary.cooldown, {
        color: weapon.color, segments: HUD_BAR_SEGMENTS, label: weapon.label, valueLabel: primary.cooldown > 0.01 ? 'CHARGING' : 'READY',
      })
      bottomRight.button({ id: 'fire-primary', x: 414, y: 88, width: 184, height: 48, label: 'fire · space', action: 'fire-primary', kind: 'hold', color: weapon.color })
    }
    if (secondary) {
      const weapon = WEAPONS[secondary.id]
      drawSegmentedBar(bottomRight.context, { x: 36, y: 178, width: 350, height: 16 }, 1 - secondary.cooldown, {
        color: weapon.color, segments: HUD_BAR_SEGMENTS, label: weapon.label, valueLabel: secondary.cooldown > 0.01 ? 'CHARGING' : 'READY',
      })
      bottomRight.button({
        id:       'fire-secondary',
        x:        414,
        y:        174,
        width:    184,
        height:   48,
        label:    secondary.needsLock && !locked ? 'needs lock' : 'missile · x',
        action:   'fire-secondary',
        kind:     'hold',
        disabled: secondary.needsLock && !locked,
        color:    weapon.color,
      })
    }
    bottomRight.text({ x: 36, y: 250, size: 13, alpha: 0.6, value: battle.carrying ? 'OBJECTIVE CORE SECURED' : 'WEAPON BUS ARMED' })
  })

  const center = panels.center
  renderPanel(center, data, frame, () => {
    center.text({ x: 280, y: 442, align: 'center', size: 15, color: battle.myTeam ? TEAM_COLORS[battle.myTeam] : THEME.pale, value: `${battle.myName?.toUpperCase() ?? 'PILOT'} · ${battle.myTeam?.toUpperCase() ?? 'UNASSIGNED'}` })
    center.text({ x: 280, y: 470, align: 'center', size: 13, alpha: 0.48, value: `${battle.scores.red} RED · ${formatHudClock(battle.timeLeft)} · BLUE ${battle.scores.blue}` })
    if (battle.primary)
      center.button({ id: 'center-fire', x: 208, y: 496, width: 144, height: 40, label: `fire ${WEAPONS[battle.primary.id].label}`, action: 'fire-primary', kind: 'hold', color: WEAPONS[battle.primary.id].color, size: 12 })
  })
}

/**
 * How close the next gate is, 0..1.
 *
 * Normalised against the level's own gate spacing rather than a flat 600 m: on
 * a tight track the old constant meant the bar sat pinned near 1 and never
 * moved, and it was computed twice with two different colours.
 */
function gateClosure (frame: HudFrame): number {
  if (!frame.target)
    return 0

  const distance = frame.shipPosition.distanceTo(frame.target)
  const span     = Math.max(frame.gateSpacing, 1)
  return 1 - THREE.MathUtils.clamp(distance / span, 0, 1)
}

function signedPercent (value: number): string {
  const percent = Math.round(THREE.MathUtils.clamp(value, -1, 1) * 100)
  return `${percent > 0 ? '+' : ''}${percent}%`
}


export function drawHudPanels (
  panels: Record<HudPanelKey, HudPanel>,
  data: HudData,
  frame: HudFrame
): void {
  if (data.mode === 'race')
    drawRacePanels(panels, data, frame)
  else
    drawBattlePanels(panels, data, frame)
}

// perf: seven grouped canvas-texture facets, updated at the compositor cadence.
