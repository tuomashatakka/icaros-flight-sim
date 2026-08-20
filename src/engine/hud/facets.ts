import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { TEAM_COLORS } from '../battle/arena'
import { WEAPONS } from '../battle/weapons'
import { HudPanel } from './panel'
import { formatHudClock, formatHudRaceTime } from './interaction'
import { HUD_VISOR_FACETS, HUD_VISOR_SURFACE } from './layout'
import type { HudVisorCorners } from './layout'
import { HUD_COLORS as COLORS, HUD_FONT as FONT } from './tokens'
import type { BattleHudData, HudData, HudFrame, HudPanelKey, RaceHudData } from './types'


const TAU = Math.PI * 2

const _forward = new THREE.Vector3()
const _up      = new THREE.Vector3()
const _euler   = new THREE.Euler()
const WORLD_UP = new THREE.Vector3(0, 1, 0)

export function createHudPanels (): Record<HudPanelKey, HudPanel> {
  return {
    topLeft:      new HudPanel({ name: 'topLeft', title: 'navigation', accent: COLORS.cyan }),
    topCenter:    new HudPanel({ name: 'topCenter', title: 'attitude', accent: COLORS.blue }),
    topRight:     new HudPanel({ name: 'topRight', title: 'target', accent: COLORS.magenta }),
    center:       new HudPanel({ name: 'center', width: 560, height: 560, center: true, accent: COLORS.white }),
    bottomLeft:   new HudPanel({ name: 'bottomLeft', title: 'defense', accent: COLORS.cyan }),
    bottomCenter: new HudPanel({ name: 'bottomCenter', title: 'propulsion', accent: COLORS.violet }),
    bottomRight:  new HudPanel({ name: 'bottomRight', title: 'power', accent: COLORS.amber }),
  }
}

export function createHudPanelMesh (panels: Record<HudPanelKey, HudPanel>): THREE.Mesh {
  const geometries: THREE.BufferGeometry[]   = []
  const materials: THREE.MeshBasicMaterial[] = []
  const indexToKey: HudPanelKey[]            = []

  for (const definition of HUD_VISOR_FACETS) {
    const geometry = createFacetGeometry(definition.corners)
    geometries.push(geometry)

    const material = new THREE.MeshBasicMaterial({
      map:         panels[definition.key].texture,
      transparent: true,
      opacity:     0.94,
      side:        THREE.DoubleSide,
      depthTest:   false,
      depthWrite:  false,
      toneMapped:  false,
    })
    materials.push(material)
    indexToKey.push(definition.key)
  }

  const merged = mergeGeometries(geometries, true)
  for (const geometry of geometries)
    geometry.dispose()
  if (!merged)
    throw new Error('failed to merge spatial hud facets')

  const mesh           = new THREE.Mesh(merged, materials)
  mesh.name            = 'spatial-cockpit-hud-seven-facets'
  mesh.renderOrder     = 1000
  mesh.frustumCulled   = false
  mesh.userData.panels = indexToKey

  const backingParts    = HUD_VISOR_SURFACE.map(createFacetGeometry)
  const backingGeometry = mergeGeometries(backingParts, false)
  for (const geometry of backingParts)
    geometry.dispose()
  if (!backingGeometry)
    throw new Error('failed to merge spatial hud backing')

  const backingMaterial = new THREE.MeshBasicMaterial({
    color:       '#03141d',
    transparent: true,
    opacity:     0.16,
    side:        THREE.DoubleSide,
    depthTest:   false,
    depthWrite:  false,
    toneMapped:  false,
  })
  const backing         = new THREE.Mesh(backingGeometry, backingMaterial)
  backing.name          = 'spatial-cockpit-hud-continuous-glass'
  backing.renderOrder   = 999
  backing.frustumCulled = false
  backing.raycast       = () => {}
  mesh.add(backing)
  return mesh
}

function createFacetGeometry (corners: HudVisorCorners): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(corners.flat(), 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
    0, 0,
    1, 0,
    0, 1,
    1, 1,
  ], 2))
  geometry.setIndex([ 0, 1, 2, 2, 1, 3 ])
  geometry.computeBoundingSphere()
  return geometry
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

function drawAttitudeScale (panel: HudPanel, pitch: number, roll: number): void {
  const { context } = panel
  const centerX     = panel.canvas.width * 0.5
  const axisY       = 154
  context.save()
  context.translate(centerX, axisY)
  context.rotate(-roll)
  context.strokeStyle = 'rgba(120, 175, 255, .58)'
  context.lineWidth   = 2
  context.beginPath()
  context.moveTo(64 - centerX, 0)
  context.lineTo(panel.canvas.width - 64 - centerX, 0)
  context.stroke()

  for (let i = -6; i <= 6; i++) {
    const x      = i * 34
    const height = i % 3 === 0 ? 25 : 12
    context.beginPath()
    context.moveTo(x, -height)
    context.lineTo(x, height)
    context.stroke()
  }

  const horizonY      = 64 + THREE.MathUtils.clamp(pitch, -1, 1) * 38
  context.strokeStyle = COLORS.white
  context.lineWidth   = 3
  context.beginPath()
  context.moveTo(-48, horizonY)
  context.lineTo(-10, horizonY)
  context.moveTo(10, horizonY)
  context.lineTo(48, horizonY)
  context.stroke()
  context.beginPath()
  context.arc(0, horizonY, 9, 0, TAU)
  context.stroke()
  context.restore()
}

function drawCheckpointPips (panel: HudPanel, total: number, next: number): void {
  const { context } = panel
  const count       = Math.max(1, total)
  const gap         = 4
  const width       = (390 - gap * (count - 1)) / count

  for (let i = 0; i < count; i++) {
    const x           = 36 + i * (width + gap)
    const isNext      = i === next
    const isComplete  = i < next
    context.fillStyle = isNext
      ? COLORS.magenta
      : isComplete
        ? COLORS.cyan
        : 'rgba(126, 168, 190, .18)'
    context.fillRect(x, 232, width, isNext ? 20 : 13)
  }

  panel.text({
    x:     36,
    y:     278,
    size:  13,
    alpha: 0.56,
    value: `NEXT ${Math.min(next + 1, count)} · ${Math.max(0, count - next)} CHECKPOINTS REMAIN`,
  })
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
        : 'rgba(180, 215, 225, .42)'
    const fill        = Math.max(0, Math.min(1, zone.progress))
    context.fillStyle = 'rgba(8, 18, 28, .78)'
    context.fillRect(x, 210, width, 52)
    context.fillStyle = `${color}44`
    context.fillRect(x, 210 + 52 * (1 - fill), width, 52 * fill)
    context.strokeStyle = zone.contested ? COLORS.amber : color
    context.lineWidth   = zone.contested ? 3 : 2
    context.strokeRect(x, 210, width, 52)
    context.font         = `700 16px ${FONT}`
    context.textAlign    = 'center'
    context.textBaseline = 'middle'
    context.fillStyle    = color
    context.fillText(zone.short, x + width * 0.5, 236)
  })
}

function drawReticle (panel: HudPanel, data: HudData, frame: HudFrame): void {
  const { context, canvas } = panel
  const centerX             = canvas.width * 0.5
  const centerY             = canvas.height * 0.5 + frame.aimPitch * 72
  const battle              = data.mode === 'battle' ? data.battle : null
  const lock                = battle?.lockOn
  const locked              = lock?.phase === 'locked'
  const tracking            = lock?.phase === 'tracking'
  const color               = locked ? COLORS.magenta : tracking ? COLORS.amber : COLORS.white

  context.strokeStyle = color
  context.lineWidth   = 3
  context.globalAlpha = 0.9
  context.beginPath()
  context.moveTo(centerX - 78, centerY)
  context.lineTo(centerX - 24, centerY)
  context.moveTo(centerX + 24, centerY)
  context.lineTo(centerX + 78, centerY)
  context.moveTo(centerX, centerY - 78)
  context.lineTo(centerX, centerY - 24)
  context.moveTo(centerX, centerY + 24)
  context.lineTo(centerX, centerY + 78)
  context.stroke()

  context.lineWidth   = 2
  context.globalAlpha = 0.48
  for (let i = 0; i < 4; i++) {
    const start = 0.18 + i * Math.PI * 0.5
    context.beginPath()
    context.arc(centerX, centerY, 48, start, start + 1.06)
    context.stroke()
  }

  if (lock && lock.phase !== 'idle') {
    const progress      = Math.max(0, Math.min(1, lock.progress))
    context.strokeStyle = color
    context.globalAlpha = 0.95
    context.lineWidth   = 4
    context.beginPath()
    context.arc(centerX, centerY, 74, -Math.PI * 0.5, -Math.PI * 0.5 + TAU * progress)
    context.stroke()
    if (locked) {
      const size = 94
      context.strokeRect(centerX - size, centerY - size, size * 2, size * 2)
    }
  }

  context.globalAlpha  = 0.76
  context.fillStyle    = color
  context.font         = `500 14px ${FONT}`
  context.textAlign    = 'center'
  context.textBaseline = 'middle'

  const label          = lock?.phase === 'locked'
    ? `${lock.name?.toUpperCase() ?? 'TARGET'} / LOCK / ${lock.distance} M`
    : lock?.phase === 'tracking'
      ? `ACQUIRING ${Math.round(lock.progress * 100)}% / ${lock.name?.toUpperCase() ?? 'TARGET'}`
      : data.mode === 'race'
        ? `${frame.targetLabel || 'FREE VECTOR'} / ${Math.round(frame.target ? frame.shipPosition.distanceTo(frame.target) : 0)} M`
        : 'FREE VECTOR'
  context.fillText(label, centerX, centerY + 126)

  if (data.mode === 'battle')
    data.battle.killFeed.slice(0, 3).forEach((entry, index) => {
      context.globalAlpha = 0.72 - index * 0.14
      context.fillStyle   = entry.team ? TEAM_COLORS[entry.team] : COLORS.white
      context.font        = `500 12px ${FONT}`
      context.fillText(
        `${entry.killer.toUpperCase()} / ${entry.weapon ? WEAPONS[entry.weapon].label.toUpperCase() : 'RAM'} / ${entry.victim.toUpperCase()}`,
        centerX,
        70 + index * 22
      )
    })
  context.globalAlpha = 1
}

function drawRacePanels (panels: Record<HudPanelKey, HudPanel>, data: RaceHudData, frame: HudFrame): void {
  const race               = data.race
  const telemetry          = frame.telemetry
  const targetDistance     = frame.target ? frame.shipPosition.distanceTo(frame.target) : 0
  const heading            = headingFrom(frame.hullQuaternion)
  const view               = frame.cameraBlend > 0.5 ? 'COCKPIT' : 'CHASE'
  const upness             = surfaceAlignment(frame.hullQuaternion)
  const roll               = rollFrom(frame.hullQuaternion)
  const targetClosure      = frame.target ? 1 - THREE.MathUtils.clamp(targetDistance / 600, 0, 1) : 0
  const checkpointProgress = race.checkpointCount > 0
    ? race.nextCheckpoint / race.checkpointCount
    : 0
  const courseProgress = race.loop
    ? (race.currentLap - 1 + checkpointProgress) / Math.max(race.laps, 1)
    : checkpointProgress
  const speedRatio = telemetry.speed / Math.max(data.targetSpeed, 1)

  const topLeft = panels.topLeft
  topLeft.title = 'navigation'
  topLeft.begin()
  topLeft.text({ x: 36, y: 96, size: 18, color: '#b9ffff', value: `HDG ${String(Math.round(heading) % 360).padStart(3, '0')}°` })
  topLeft.text({ x: 36, y: 128, size: 15, alpha: 0.62, value: `${frame.targetLabel || 'VECTOR'} / GATE ${frame.checkpointNumber}/${Math.max(frame.checkpointCount, 1)}` })
  topLeft.bar({ x: 36, y: 172, width: 390, height: 16, label: 'gate closure', value: targetClosure, color: COLORS.cyan, color2: COLORS.blue })
  topLeft.button({ id: 'menu', x: 456, y: 90, width: 142, height: 44, label: 'menu', action: 'menu' })
  topLeft.button({ id: 'view', x: 456, y: 148, width: 142, height: 44, label: view, action: 'view', active: frame.cameraBlend > 0.5 })
  drawCheckpointPips(topLeft, frame.checkpointCount, race.nextCheckpoint)
  topLeft.finish(frame.elapsed)

  const topCenter = panels.topCenter
  topCenter.title = 'attitude'
  topCenter.begin()

  const status = race.status === 'countdown'
    ? `LAUNCH · ${Math.max(1, Math.ceil(data.clocks.countdown))}`
    : race.status === 'finished'
      ? 'COURSE COMPLETE'
      : telemetry.boosting
        ? 'BOOST · FLIGHT'
        : 'CRUISE · FLIGHT'
  topCenter.text({ x: 320, y: 92, size: 18, align: 'center', color: '#dfeaff', value: status })
  drawAttitudeScale(topCenter, frame.aimPitch, roll)
  topCenter.text({ x: 36, y: 278, size: 13, alpha: 0.55, value: `TURN ${signedPercent(frame.steer)} · STRAFE ${signedPercent(frame.strafe)} · AIM ${signedPercent(frame.aimPitch)}` })
  topCenter.button({ id: 'attitude-view', x: 500, y: 254, width: 108, height: 38, label: view, action: 'view', active: frame.cameraBlend > 0.5, size: 13 })
  topCenter.finish(frame.elapsed)

  const topRight = panels.topRight
  topRight.title = 'target'
  topRight.begin()
  topRight.text({ x: 36, y: 98, size: 19, color: '#ffd8eb', value: frame.target ? `GATE ${frame.checkpointNumber} · ${frame.targetLabel}` : 'NO ROUTE TARGET' })
  topRight.text({ x: 36, y: 132, size: 15, alpha: 0.62, value: `RANGE ${Math.round(targetDistance)} m · SPEED ${Math.round(telemetry.speed * 3.6)} km/h` })
  topRight.bar({ x: 36, y: 176, width: 390, height: 16, label: 'gate closure', value: targetClosure, color: COLORS.magenta, color2: COLORS.violet })
  topRight.button({ id: 'respawn', x: 456, y: 90, width: 142, height: 44, label: 'respawn', action: 'respawn', color: COLORS.magenta })
  topRight.button({ id: 'tuning', x: 456, y: 148, width: 142, height: 44, label: 'tuning', action: 'tuning-toggle', active: data.tuningOpen, color: COLORS.magenta })
  drawTargetGlyph(topRight, frame.target !== null)
  topRight.finish(frame.elapsed)

  const bottomLeft = panels.bottomLeft
  bottomLeft.title = 'defense'
  bottomLeft.begin()
  bottomLeft.bar({ x: 36, y: 104, width: 404, height: 18, label: 'surface alignment', value: upness, color: COLORS.cyan, color2: COLORS.blue })
  bottomLeft.bar({ x: 36, y: 178, width: 404, height: 18, label: 'boost reserve', value: telemetry.boostMeter, color: COLORS.green, color2: '#d6f66c' })
  bottomLeft.text({ x: 36, y: 246, size: 15, alpha: 0.64, value: `${telemetry.grounded ? 'SURFACE LOCK' : 'AIRBORNE'} · IMPACTS ${telemetry.crashSeq}` })
  bottomLeft.button({ id: 'defense-reset', x: 466, y: 120, width: 132, height: 52, label: 'reset', action: 'respawn' })
  bottomLeft.finish(frame.elapsed)

  const bottomCenter = panels.bottomCenter
  bottomCenter.title = 'propulsion'
  bottomCenter.begin()
  bottomCenter.bar({ x: 36, y: 118, width: 410, height: 22, label: 'throttle', value: frame.throttle, color: COLORS.violet, color2: COLORS.cyan })
  bottomCenter.text({ x: 36, y: 196, size: 18, color: '#d9ccff', value: `${Math.round(telemetry.speed * 3.6)} / ${Math.round(data.targetSpeed * 3.6)} km/h` })
  bottomCenter.text({ x: 36, y: 236, size: 14, alpha: 0.56, value: `TURN ${signedPercent(frame.steer)} · STRAFE ${signedPercent(frame.strafe)} · ${telemetry.boosting ? 'BOOST ACTIVE' : 'CRUISE'}` })
  bottomCenter.button({ id: 'boost', x: 466, y: 116, width: 132, height: 54, label: 'boost', action: 'boost', kind: 'hold', active: telemetry.boosting, color: '#d5a8ff' })
  bottomCenter.finish(frame.elapsed)

  const bottomRight = panels.bottomRight
  bottomRight.title = 'race systems'
  bottomRight.begin()
  bottomRight.bar({ x: 36, y: 104, width: 404, height: 18, label: 'course', value: courseProgress, color: COLORS.amber, color2: COLORS.magenta })
  bottomRight.bar({ x: 36, y: 178, width: 404, height: 18, label: 'target velocity', value: speedRatio, color: '#ffe99f', color2: '#6ff0d4' })
  bottomRight.text({ x: 36, y: 246, size: 15, alpha: 0.64, value: `${data.shipId.toUpperCase()} · ZONE ${data.zone} · LAP ${race.loop ? `${Math.min(race.currentLap, race.laps)}/${race.laps}` : 'SPRINT'} · ${formatHudRaceTime(data.clocks.lapElapsed)}` })
  bottomRight.button({ id: 'race-tuning', x: 466, y: 120, width: 132, height: 52, label: 'tune', action: 'tuning-toggle', active: data.tuningOpen, color: COLORS.amber })
  bottomRight.finish(frame.elapsed)

  const center = panels.center
  center.begin()
  drawReticle(center, data, frame)
  center.text({ x: 280, y: 442, align: 'center', size: 15, alpha: 0.68, value: `LAP ${race.loop ? `${Math.min(race.currentLap, race.laps)}/${race.laps}` : 'SPRINT'} · ${formatHudRaceTime(data.clocks.elapsed)}` })
  center.text({ x: 280, y: 470, align: 'center', size: 13, alpha: 0.48, value: race.bestLap === null ? 'BEST --:--.---' : `BEST ${formatHudRaceTime(race.bestLap)}` })
  center.button({ id: 'center-boost', x: 208, y: 496, width: 144, height: 40, label: 'hold boost', action: 'boost', kind: 'hold', active: telemetry.boosting, color: COLORS.violet, size: 13 })
  center.finish(frame.elapsed)
}

function drawBattlePanels (panels: Record<HudPanelKey, HudPanel>, data: BattleHudData, frame: HudFrame): void {
  const battle   = data.battle
  const locked   = battle.lockOn.phase === 'locked'
  const tracking = battle.lockOn.phase === 'tracking'
  const health   = battle.myHealth / Math.max(1, battle.maxHealth)
  const target   = battle.roster.find(entry => entry.id === battle.lockOn.targetId)
  const roll     = rollFrom(frame.hullQuaternion)

  const topLeft = panels.topLeft
  topLeft.title = 'tactical'
  topLeft.begin()
  topLeft.text({ x: 36, y: 96, size: 20, color: TEAM_COLORS.red, value: `RED ${battle.scores.red}` })
  topLeft.text({ x: 210, y: 96, size: 15, color: TEAM_COLORS.blue, value: `BLUE ${battle.scores.blue} · FIRST ${battle.scoreTarget}` })
  topLeft.bar({ x: 36, y: 150, width: 390, height: 16, label: 'red score', value: battle.scores.red / Math.max(1, battle.scoreTarget), color: TEAM_COLORS.red, color2: COLORS.magenta })
  topLeft.button({ id: 'battle-menu', x: 456, y: 90, width: 142, height: 44, label: 'menu', action: 'menu' })
  topLeft.button({ id: 'battle-view', x: 456, y: 148, width: 142, height: 44, label: frame.cameraBlend > 0.5 ? 'cockpit' : 'chase', action: 'view', active: frame.cameraBlend > 0.5 })
  drawZonePips(topLeft, data)
  topLeft.finish(frame.elapsed)

  const topCenter = panels.topCenter
  topCenter.title = 'attitude'
  topCenter.begin()

  const status = battle.status === 'countdown'
    ? `DEPLOY · ${Math.max(1, Math.ceil(battle.countdown))}`
    : battle.status === 'finished'
      ? 'MATCH OVER'
      : battle.status === 'live'
        ? `COMBAT · ${formatHudClock(battle.timeLeft)}`
        : battle.status.toUpperCase()
  topCenter.text({ x: 320, y: 92, size: 18, align: 'center', color: '#dfeaff', value: status })
  drawAttitudeScale(topCenter, frame.aimPitch, roll)
  topCenter.text({ x: 36, y: 278, size: 13, alpha: 0.55, value: `TURN ${signedPercent(frame.steer)} · STRAFE ${signedPercent(frame.strafe)} · NET ${battle.hashMatchStatus.toUpperCase()} ${battle.verifiedTicks}` })
  topCenter.button({ id: 'battle-attitude-view', x: 500, y: 254, width: 108, height: 38, label: frame.cameraBlend > 0.5 ? 'cockpit' : 'chase', action: 'view', active: frame.cameraBlend > 0.5, size: 13 })
  topCenter.finish(frame.elapsed)

  const topRight = panels.topRight
  topRight.title = 'target'
  topRight.begin()
  topRight.text({ x: 36, y: 98, size: 19, color: '#ffd8eb', value: locked ? `LOCKED · ${battle.lockOn.name?.toUpperCase() ?? 'TARGET'}` : tracking ? `ACQUIRING · ${battle.lockOn.name?.toUpperCase() ?? 'TARGET'}` : 'NO HARD LOCK' })
  topRight.text({ x: 36, y: 132, size: 15, alpha: 0.62, value: `RANGE ${battle.lockOn.distance || 0} m · ${target ? `${target.team.toUpperCase()} · K/D ${target.kills}/${target.deaths}` : 'NO CONTACT DATA'}` })
  topRight.bar({ x: 36, y: 176, width: 390, height: 16, label: 'lock signal', value: battle.lockOn.progress, color: COLORS.magenta, color2: COLORS.violet })
  topRight.button({ id: 'battle-respawn', x: 456, y: 90, width: 142, height: 44, label: 'respawn', action: 'respawn', color: COLORS.magenta })
  topRight.button({ id: 'battle-view-right', x: 456, y: 148, width: 142, height: 44, label: 'view', action: 'view', color: COLORS.magenta })
  drawTargetGlyph(topRight, locked || tracking)
  topRight.finish(frame.elapsed)

  const bottomLeft = panels.bottomLeft
  bottomLeft.title = 'defense'
  bottomLeft.begin()
  bottomLeft.bar({ x: 36, y: 104, width: 390, height: 18, label: 'hull', value: health, color: health < 0.3 ? COLORS.red : COLORS.cyan, color2: health < 0.3 ? COLORS.amber : COLORS.blue })
  bottomLeft.bar({ x: 36, y: 178, width: 390, height: 18, label: 'boost', value: battle.myBoost, color: COLORS.green, color2: '#d6f66c' })
  bottomLeft.text({ x: 36, y: 246, size: 15, alpha: 0.64, value: `HULL ${battle.myHealth}/${battle.maxHealth} · K/D ${battle.myKills}/${battle.myDeaths}` })
  bottomLeft.button({ id: 'battle-defense-respawn', x: 466, y: 120, width: 132, height: 52, label: 'respawn', action: 'respawn' })
  bottomLeft.text({ x: 598, y: 246, size: 13, align: 'right', color: battle.carrying ? TEAM_COLORS[battle.carrying] : COLORS.cyan, value: battle.carrying ? `${battle.carrying.toUpperCase()} CORE` : 'CORE BAY EMPTY' })
  bottomLeft.finish(frame.elapsed)

  const bottomCenter = panels.bottomCenter
  bottomCenter.title = 'propulsion'
  bottomCenter.begin()
  bottomCenter.bar({ x: 36, y: 118, width: 410, height: 22, label: 'throttle', value: frame.throttle, color: COLORS.violet, color2: COLORS.cyan })
  bottomCenter.text({ x: 36, y: 196, size: 18, color: '#d9ccff', value: `${Math.round(frame.telemetry.speed * 3.6)} km/h` })
  bottomCenter.text({ x: 36, y: 236, size: 14, alpha: 0.56, value: `TURN ${signedPercent(frame.steer)} · STRAFE ${signedPercent(frame.strafe)} · ${battle.myBoost < 0.15 ? 'BOOST CRITICAL' : 'ARMED'}` })
  bottomCenter.button({ id: 'battle-boost', x: 466, y: 116, width: 132, height: 54, label: 'boost', action: 'boost', kind: 'hold', active: frame.telemetry.boosting, color: '#d5a8ff' })
  bottomCenter.finish(frame.elapsed)

  const primary     = battle.primary
  const secondary   = battle.secondary
  const bottomRight = panels.bottomRight
  bottomRight.title = 'weapons'
  bottomRight.begin()
  if (primary) {
    const weapon = WEAPONS[primary.id]
    bottomRight.bar({ x: 36, y: 104, width: 350, height: 18, label: weapon.label, value: 1 - primary.cooldown, color: weapon.color, color2: COLORS.magenta })
    bottomRight.button({ id: 'fire-primary', x: 414, y: 88, width: 184, height: 48, label: 'fire · space', action: 'fire-primary', kind: 'hold', color: weapon.color })
  }
  if (secondary) {
    const weapon = WEAPONS[secondary.id]
    bottomRight.bar({ x: 36, y: 190, width: 350, height: 18, label: weapon.label, value: 1 - secondary.cooldown, color: weapon.color, color2: COLORS.amber })
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
  bottomRight.text({ x: 36, y: 264, size: 14, alpha: 0.6, value: battle.carrying ? 'OBJECTIVE CORE SECURED' : 'WEAPON BUS ARMED' })
  bottomRight.finish(frame.elapsed)

  const center = panels.center
  center.begin()
  drawReticle(center, data, frame)
  center.text({ x: 280, y: 442, align: 'center', size: 15, color: battle.myTeam ? TEAM_COLORS[battle.myTeam] : COLORS.white, value: `${battle.myName?.toUpperCase() ?? 'PILOT'} · ${battle.myTeam?.toUpperCase() ?? 'UNASSIGNED'}` })
  center.text({ x: 280, y: 470, align: 'center', size: 13, alpha: 0.48, value: `${battle.scores.red} RED · ${formatHudClock(battle.timeLeft)} · BLUE ${battle.scores.blue}` })
  if (battle.primary)
    center.button({ id: 'center-fire', x: 208, y: 496, width: 144, height: 40, label: `fire ${WEAPONS[battle.primary.id].label}`, action: 'fire-primary', kind: 'hold', color: WEAPONS[battle.primary.id].color, size: 12 })
  center.finish(frame.elapsed)
}

function drawTargetGlyph (panel: HudPanel, active: boolean): void {
  const { context }   = panel
  const x             = 504
  const y             = 254
  const color         = active ? COLORS.magenta : 'rgba(255, 120, 189, .38)'
  context.strokeStyle = color
  context.lineWidth   = active ? 3 : 2
  context.beginPath()
  context.arc(x, y, 38, 0, TAU)
  context.stroke()
  context.beginPath()
  context.arc(x, y, 20, 0, TAU)
  context.stroke()
  context.beginPath()
  context.moveTo(x - 52, y)
  context.lineTo(x - 18, y)
  context.moveTo(x + 18, y)
  context.lineTo(x + 52, y)
  context.moveTo(x, y - 52)
  context.lineTo(x, y - 18)
  context.moveTo(x, y + 18)
  context.lineTo(x, y + 52)
  context.stroke()
}

function headingFrom (quaternion: THREE.Quaternion): number {
  _forward.set(0, 0, 1).applyQuaternion(quaternion)
  return (THREE.MathUtils.radToDeg(Math.atan2(_forward.x, _forward.z)) + 360) % 360
}

function surfaceAlignment (quaternion: THREE.Quaternion): number {
  return THREE.MathUtils.clamp(_up.set(0, 1, 0).applyQuaternion(quaternion)
    .dot(WORLD_UP), 0, 1)
}

function rollFrom (quaternion: THREE.Quaternion): number {
  return _euler.setFromQuaternion(quaternion, 'YXZ').z
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
