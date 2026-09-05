import * as THREE from 'three'
import type { Controls } from '../input'
import { setTouchOverlayActive } from '../input'
import { createHudStation, hudStation } from './anchor'
import { createHudPanelMesh, createHudPanels, disposeHudPanelMesh, drawHudPanels, tickHudPanelMesh } from './facets'
import { HUD_AXIS_GATE, hudSliderValue, shapeHudAxis } from './interaction'
import { drawHudOverlay, isHudBlockingOverlay } from './overlay'
import { HudPanel } from './panel'
import { HUD_OVERLAY_PERIOD, HUD_PANEL_PERIOD, HUD_REFERENCE_FOV } from './tokens'
import type { HudActionId, HudData, HudFrame, HudPanelKey, HudRegion, HudSource } from './types'


const _ndc = new THREE.Vector2()

type SpatialHudOptions = {
  canvas:   HTMLCanvasElement;
  controls: Controls;
  source:   HudSource;
}

export type SpatialHud = {
  object: THREE.Group;
  update(frame: HudFrame): void;
  dispose(): void;
}

type ActivePointer = {
  region: HudRegion;
  startX: number;
  startY: number;
  lastX:  number;
  lastY:  number;
}

/**
 * The shared, canvas-owned race and battle HUD.
 *
 * Seven `CanvasTexture` facets reproduce the reference visor while one screen
 * plane handles full-screen moments and touch controls. React never sees a
 * frame-rate value or pointer move, and every allocation has a paired dispose.
 */
export function createSpatialHud ({ canvas, controls, source }: SpatialHudOptions): SpatialHud {
  const station   = createHudStation()
  const panels    = createHudPanels()
  const panelMesh = createHudPanelMesh(panels)
  const visorRoot = new THREE.Group()
  visorRoot.add(panelMesh)

  const overlay         = new HudPanel({ name: 'overlay', width: 1280, height: 720, center: true })
  const overlayGeometry = new THREE.PlaneGeometry(2, 2)
  const overlayMaterial = new THREE.MeshBasicMaterial({
    map:         overlay.texture,
    transparent: true,
    depthTest:   false,
    depthWrite:  false,
    toneMapped:  false,
  })
  const overlayMesh         = new THREE.Mesh(overlayGeometry, overlayMaterial)
  overlayMesh.name          = 'spatial-cockpit-hud-screen-layer'
  overlayMesh.renderOrder   = 1001
  overlayMesh.frustumCulled = false

  const overlayRoot = new THREE.Group()
  overlayRoot.add(overlayMesh)

  const object = new THREE.Group()
  object.name  = 'spatial-cockpit-hud'
  object.add(visorRoot, overlayRoot)

  const raycaster      = new THREE.Raycaster()
  const activePointers = new Map<number, ActivePointer>()
  const stickX         = { move: 0, aim: 0 }
  const stickY         = { move: 0, aim: 0 }
  const toastBorn      = new Map<string, number>()

  const isTouch = window.matchMedia('(pointer: coarse)').matches ||
    navigator.maxTouchPoints > 0 ||
    process.env.NODE_ENV !== 'production' && new URLSearchParams(window.location.search).get('touch') === '1'
  const hidden = process.env.NODE_ENV !== 'production' &&
    new URLSearchParams(window.location.search).get('nohud') === '1'

  if (isTouch)
    setTouchOverlayActive(true)

  let lastFrame: HudFrame | null = null
  let lastData: HudData          = source.read()
  let panelDrawAt                = -Infinity
  let overlayDrawAt              = -Infinity
  let overlayDirty               = true
  let lastCrashSeq               = 0
  let crashUntil                 = -Infinity
  let copyUntil                  = -Infinity
  let hoverId: string | null     = null
  let disposed                   = false

  object.visible = !hidden

  function syncPose (frame: HudFrame): void {
    const camera = frame.camera
    const aspect = camera instanceof THREE.PerspectiveCamera ? camera.aspect : canvas.clientWidth / Math.max(canvas.clientHeight, 1)
    const fov    = camera instanceof THREE.PerspectiveCamera ? camera.fov : HUD_REFERENCE_FOV

    // Seated the visor is worn; in chase it is a hologram the ship carries.
    // `hudStation` is the single continuous function between the two, so the
    // pinch blend moves the anchor as well as the depth.
    hudStation(station, frame)
    visorRoot.position.copy(station.position)
    visorRoot.quaternion.copy(station.quaternion)
    visorRoot.scale.set(station.scale.x, station.scale.y, 1)
    visorRoot.updateMatrixWorld(true)

    const distance   = 4.35
    const halfHeight = Math.tan(THREE.MathUtils.degToRad(fov * 0.5)) * distance
    overlayRoot.position.copy(camera.position)
    overlayRoot.quaternion.copy(camera.quaternion)
    overlayRoot.translateZ(-distance)
    overlayMesh.scale.set(halfHeight * aspect, halfHeight, 1)
    overlayRoot.updateMatrixWorld(true)

    const targetHeight = 720
    let targetWidth = Math.max(420, Math.round(targetHeight * aspect))
    let height      = targetHeight
    if (targetWidth > 1600) {
      height      = Math.round(targetHeight * 1600 / targetWidth)
      targetWidth = 1600
    }
    if (overlay.canvas.width !== targetWidth || overlay.canvas.height !== height) {
      overlay.canvas.width  = targetWidth
      overlay.canvas.height = height
      overlayDirty = true
    }
  }

  function expireToasts (data: HudData, elapsed: number): void {
    if (data.mode !== 'battle')
      return

    const live = new Set(data.battle.toasts)
    for (const toast of live)
      if (!toastBorn.has(toast))
        toastBorn.set(toast, elapsed)
    for (const [ toast, born ] of toastBorn) {
      if (!live.has(toast)) {
        toastBorn.delete(toast)
        continue
      }
      if (elapsed - born > 3.2) {
        source.actions.clearToast(toast)
        toastBorn.delete(toast)
        overlayDirty = true
      }
    }
  }

  function drawPanels (data: HudData, frame: HudFrame): void {
    drawHudPanels(panels, data, frame)
  }

  function drawOverlay (data: HudData, frame: HudFrame): void {
    drawHudOverlay({
      overlay,
      data,
      frame,
      crashUntil,
      copyUntil,
      isTouch,
      controls,
      stickX,
      stickY,
    })
    overlayDirty = false
  }

  function update (frame: HudFrame): void {
    if (disposed || hidden)
      return

    lastFrame = frame
    syncPose(frame)
    tickHudPanelMesh(panelMesh, frame.elapsed)

    if (frame.telemetry.crashSeq !== lastCrashSeq) {
      lastCrashSeq = frame.telemetry.crashSeq
      crashUntil   = frame.elapsed + 0.22
      overlayDirty = true
    }

    if (frame.elapsed - panelDrawAt >= HUD_PANEL_PERIOD) {
      lastData    = source.read()
      panelDrawAt = frame.elapsed
      expireToasts(lastData, frame.elapsed)
      drawPanels(lastData, frame)
      overlayDirty = true
    }

    const overlayLive = activePointers.size > 0 || isTouch || isHudBlockingOverlay(lastData) ||
      frame.elapsed < crashUntil ||
      lastData.mode === 'race' && lastData.race.status === 'countdown' ||
      lastData.mode === 'battle' && lastData.battle.toasts.length > 0
    const period = overlayLive ? HUD_OVERLAY_PERIOD : HUD_PANEL_PERIOD
    if (overlayDirty || frame.elapsed - overlayDrawAt >= period) {
      overlayDrawAt = frame.elapsed
      drawOverlay(lastData, frame)
    }
  }

  type CanvasPointReturnType = { x: number; y: number }

  function canvasPoint (clientX: number, clientY: number): CanvasPointReturnType {
    const rect = canvas.getBoundingClientRect()
    return {
      x: (clientX - rect.left) / Math.max(rect.width, 1) * overlay.canvas.width,
      y: (clientY - rect.top) / Math.max(rect.height, 1) * overlay.canvas.height,
    }
  }

  function hitAt (clientX: number, clientY: number): HudRegion | null {
    if (hidden || !lastFrame)
      return null

    const point      = canvasPoint(clientX, clientY)
    const overlayHit = overlay.hitTest(point.x, point.y)
    if (overlayHit)
      return overlayHit

    const rect = canvas.getBoundingClientRect()
    _ndc.set(
      (clientX - rect.left) / Math.max(rect.width, 1) * 2 - 1,
      -((clientY - rect.top) / Math.max(rect.height, 1) * 2 - 1)
    )
    raycaster.setFromCamera(_ndc, lastFrame.camera)

    const hit = raycaster.intersectObject(panelMesh, false)[0]
    if (!hit?.uv || !Number.isInteger(hit.face?.materialIndex))
      return null

    const keys  = panelMesh.userData.panels as HudPanelKey[]
    const panel = panels[keys[hit.face!.materialIndex]]
    return panel.hitTest(hit.uv.x * panel.canvas.width, (1 - hit.uv.y) * panel.canvas.height)
  }

  function setHover (clientX: number, clientY: number): void {
    if (!lastFrame)
      return

    const hit       = hitAt(clientX, clientY)
    const nextId    = hit?.id ?? null
    overlay.hovered = hit && overlay.regions.includes(hit) ? nextId : null
    for (const panel of Object.values(panels))
      panel.hovered = hit && panel.regions.includes(hit) ? nextId : null
    canvas.style.cursor = hit ? 'pointer' : 'crosshair'
    if (hoverId !== nextId) {
      hoverId     = nextId
      panelDrawAt = -Infinity
      overlayDirty = true
    }
  }

  function hold (action: HudActionId | undefined, down: boolean): void {
    switch (action) {
      case 'boost':
        controls.boost = down
        break
      case 'fire-primary':
        controls.fire = down
        break
      case 'fire-secondary':
        controls.fireSecondary = down
        break
      default:
        break
    }
  }

  function activate (region: HudRegion): void {
    if (region.id.startsWith('toast:')) {
      source.actions.clearToast(region.id.slice('toast:'.length))
      overlayDirty = true
      return
    }

    switch (region.action) {
      case 'menu':
        source.actions.menu()
        break
      case 'view':
        controls.viewSeq++
        break
      case 'respawn':
        controls.resetSeq++
        break
      case 'race-again':
        source.actions.raceAgain()
        controls.resetSeq++
        break
      case 'tuning-toggle':
        source.actions.toggleTuning()
        overlayDirty = true
        break
      case 'tuning-reset':
        source.actions.resetTuning()
        overlayDirty = true
        break
      case 'tuning-copy':
        void source.actions.copyTuning()
          .finally(() => {
            copyUntil   = (lastFrame?.elapsed ?? 0) + 1.4
            overlayDirty = true
          })
        break
      default:
        break
    }
  }

  function applyStick (stick: 'move' | 'aim', x: number, y: number): void {
    stickX[stick] = x
    stickY[stick] = y

    const shapedX = shapeHudAxis(x)
    const shapedY = shapeHudAxis(-y)

    if (stick === 'move') {
      controls.strafe   = shapedX
      controls.throttle = shapedY > HUD_AXIS_GATE
      controls.brake    = shapedY < -HUD_AXIS_GATE
      controls.reverse  = shapedY < -HUD_AXIS_GATE
    }
    else {
      controls.steer = shapedX
      controls.pitch = shapedY
    }
    overlayDirty = true
  }

  function applySlider (region: HudRegion, clientX: number): void {
    if (!region.tuning)
      return

    const point = canvasPoint(clientX, 0)
    const value = hudSliderValue(
      point.x,
      region.x,
      region.width,
      region.tuning.min,
      region.tuning.max,
      region.tuning.step
    )
    source.actions.setTuning(region.tuning.key, value)
    lastData     = source.read()
    overlayDirty = true
  }

  function tryCapture (event: PointerEvent): void {
    try {
      canvas.setPointerCapture(event.pointerId)
    }
    catch {
      // The pointer can disappear between queueing and capture on mobile.
    }
  }

  const onPointerDown = (event: PointerEvent) => {
    const region = hitAt(event.clientX, event.clientY)
    if (!region)
      return

    event.preventDefault()
    event.stopImmediatePropagation()
    tryCapture(event)
    activePointers.set(event.pointerId, {
      region,
      startX: event.clientX,
      startY: event.clientY,
      lastX:  event.clientX,
      lastY:  event.clientY,
    })

    if (region.kind === 'hold')
      hold(region.action, true)
    else if (region.kind === 'stick' && region.stick)
      applyStick(region.stick, 0, 0)
    else if (region.kind === 'slider')
      applySlider(region, event.clientX)
  }

  const onPointerMove = (event: PointerEvent) => {
    const active = activePointers.get(event.pointerId)
    if (!active) {
      if (event.pointerType !== 'touch')
        setHover(event.clientX, event.clientY)
      return
    }

    event.preventDefault()
    event.stopImmediatePropagation()
    active.lastX = event.clientX
    active.lastY = event.clientY

    if (active.region.kind === 'stick' && active.region.stick) {
      const rect   = canvas.getBoundingClientRect()
      const radius = Math.max(42, Math.min(rect.width, rect.height) * 0.12)
      let x = (event.clientX - active.startX) / radius
      let y = (event.clientY - active.startY) / radius
      const length = Math.hypot(x, y)
      if (length > 1) {
        x /= length
        y /= length
      }
      applyStick(active.region.stick, x, y)
    }
    else if (active.region.kind === 'slider')
      applySlider(active.region, event.clientX)
  }

  const endPointer = (event: PointerEvent, cancelled = false) => {
    const active = activePointers.get(event.pointerId)
    if (!active)
      return

    event.preventDefault()
    event.stopImmediatePropagation()
    activePointers.delete(event.pointerId)
    if (canvas.hasPointerCapture(event.pointerId))
      canvas.releasePointerCapture(event.pointerId)

    if (active.region.kind === 'hold')
      hold(active.region.action, false)
    else if (active.region.kind === 'stick' && active.region.stick)
      applyStick(active.region.stick, 0, 0)
    else if (!cancelled && active.region.kind === 'button' &&
             Math.hypot(event.clientX - active.startX, event.clientY - active.startY) < 22)
      activate(active.region)

    overlayDirty = true
  }

  const onPointerUp     = (event: PointerEvent) => endPointer(event)
  const onPointerCancel = (event: PointerEvent) => endPointer(event, true)
  const onPointerLeave  = () => {
    const hadHover  = hoverId !== null
    hoverId         = null
    overlay.hovered = null
    for (const panel of Object.values(panels))
      panel.hovered = null
    canvas.style.cursor = 'crosshair'
    if (hadHover) {
      panelDrawAt = -Infinity
      overlayDirty = true
    }
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerCancel)
  canvas.addEventListener('pointerleave', onPointerLeave)

  return {
    object,
    update,

    dispose () {
      disposed = true
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerCancel)
      canvas.removeEventListener('pointerleave', onPointerLeave)
      canvas.style.cursor = ''
      if (isTouch)
        setTouchOverlayActive(false)

      controls.boost         = false
      controls.fire          = false
      controls.fireSecondary = false
      if (isTouch) {
        controls.steer    = 0
        controls.strafe   = 0
        controls.pitch    = 0
        controls.throttle = false
        controls.brake    = false
        controls.reverse  = false
      }
      for (const panel of Object.values(panels))
        panel.dispose()
      overlay.dispose()
      overlayGeometry.dispose()
      overlayMaterial.dispose()

      disposeHudPanelMesh(panelMesh)
      object.removeFromParent()
      object.clear()
      activePointers.clear()
      toastBorn.clear()
    },
  }
}


// perf: nine draw calls total; panels upload at 12 hz and the overlay at up to 30 hz.
