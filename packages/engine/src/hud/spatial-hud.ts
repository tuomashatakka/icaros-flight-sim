import * as THREE from 'three'
import type { Controls } from '../input'
import { setTouchOverlayActive } from '../input'
import { createHudStation, hudStation } from './anchor'
import { createHudPanelMesh, createHudPanels, disposeHudPanelMesh, drawHudPanels, tickHudPanelMesh } from './facets'
import { HUD_AXIS_GATE, hudSliderValue, shapeHudAxis } from './interaction'
import { drawHudOverlay, isHudBlockingOverlay } from './overlay'
import { HudPanel } from './panel'
import { createTouchGestures } from './pointers'
import { HUD_TRANSITION_S, createHudReveal } from './transition'
import { HUD_OVERLAY_PERIOD, HUD_PANEL_HZ, HUD_REFERENCE_FOV } from './tokens'
import { NO_INSETS, touchLayout, wantsTouchControls } from './touch-layout'
import type { SafeAreaInsets } from './touch-layout'
import type { HudActionId, HudData, HudFrame, HudPanelKey, HudRegion, HudSource } from './types'


const _ndc = new THREE.Vector2()

/**
 * The device's safe-area insets, in CSS pixels.
 *
 * Nothing in the app read these before, and `src/app/layout.tsx` had no
 * `viewport-fit=cover`, so on a phone the bottom row of controls sat under the
 * home indicator and the top under the URL bar. Measured off a throwaway
 * element because `env()` is only resolvable by the style engine.
 */
/** When the rail follows the visor in, in seconds. See its use for the derivation. */
const TOUCH_STAGGER_S = HUD_TRANSITION_S * 0.206

function readSafeAreaInsets (): SafeAreaInsets {
  if (typeof document === 'undefined')
    return NO_INSETS

  const probe         = document.createElement('div')
  probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;' +
    'top:env(safe-area-inset-top,0px);right:env(safe-area-inset-right,0px);' +
    'bottom:env(safe-area-inset-bottom,0px);left:env(safe-area-inset-left,0px)'
  document.body.appendChild(probe)

  const style = getComputedStyle(probe)
  const read  = (value: string) => {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  const result: SafeAreaInsets = {
    top:    read(style.top),
    right:  read(style.right),
    bottom: read(style.bottom),
    left:   read(style.left),
  }
  probe.remove()
  return result
}

type SpatialHudOptions = {
  canvas:   HTMLCanvasElement;
  controls: Controls;
  source:   HudSource;

  /**
   * The `touch` query parameter: `'1'` forces the rail on, `'0'` off.
   *
   * Passed in rather than read off `window.location` here. The engine mounts
   * outside the router, so reading the URL from this depth means reading it at
   * a moment the router does not guarantee — the page owns routing state and
   * hands it down, which is also what makes this testable without a URL.
   */
  forcedTouch?: string | null;
  panelHz?:     number;
}

export type SpatialHud = {
  object: THREE.Group;
  update(frame: HudFrame): void;
  dispose(): void;
}

type ActivePointer = {
  region: HudRegion;

  /**
   * Where the finger landed. For a stick this is also its ORIGIN: the pad
   * floats to the press point, so landing near the gate does not peg the axis
   * before the thumb has moved.
   */
  startX: number;
  startY: number;
  lastX:  number;
  lastY:  number;
}

/**
 * Overlay canvas pixel budget.
 *
 * Sized as an AREA rather than a fixed height so the canvas can match the
 * viewport's aspect exactly. The old `max(420, 720 * aspect) x 720` floored the
 * width, so a 0.46-aspect phone got a 0.58-aspect canvas stretched over it and
 * every control came out 21 % too wide.
 */
const OVERLAY_PIXELS = 1280 * 720

/** Where the screen-space plane hangs in front of the eye, world units. */
const OVERLAY_DISTANCE = 4.35

/** Look-around deflection for a dragged finger, CSS px. */
const TOUCH_PAN_RADIUS = 0.22

/** Pinch travel for a full chase-to-cockpit sweep, as a fraction of the short edge. */
const PINCH_RANGE = 0.42

/**
 * The shared, canvas-owned race and battle HUD.
 *
 * Seven `CanvasTexture` facets reproduce the reference visor while one screen
 * plane handles full-screen moments and touch controls. React never sees a
 * frame-rate value or pointer move, and every allocation has a paired dispose.
 */
export function createSpatialHud ({ canvas, controls, source, forcedTouch = null, panelHz = HUD_PANEL_HZ }: SpatialHudOptions): SpatialHud {
  const station         = createHudStation()
  const basePanelPeriod = 1 / THREE.MathUtils.clamp(panelHz, 15, 30)
  const panels          = createHudPanels()
  const panelMesh       = createHudPanelMesh(panels)
  const visorRoot       = new THREE.Group()
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
  const heldActions    = new Set<HudActionId>()
  const toastBorn      = new Map<string, number>()
  const cssSize        = { width: 1, height: 1 }
  let insets: SafeAreaInsets = NO_INSETS

  // The rail is on for everyone. `?touch=0` is the only way to turn it off, and
  //  it is honoured in EVERY build — there is no device sniff left to get a
  //  machine wrong. It arrives as a prop from the page's `useSearchParams`,
  //  because reading `window.location.search` here is a layer that knows
  //  nothing about the router: the engine mounts on its own schedule, so the
  //  value it saw was whatever the URL happened to be at that instant.
  const forced  = forcedTouch
  const coarse  = window.matchMedia('(pointer: coarse)')
  const isTouch = wantsTouchControls(forced)
  const hidden  = process.env.NODE_ENV !== 'production' &&
    new URLSearchParams(window.location.search).get('nohud') === '1'

  // Canvas drag-steering and a virtual stick want the same finger, so the
  //  pointer path drops TOUCH input while the sticks are up. Mouse and pen are
  //  untouched by this, which is what lets the rail be up on a desktop.
  if (isTouch)
    setTouchOverlayActive(true)

  /** Last computed blocking state, for the `?touch=1` readout. */
  let lastBlocking = false

  const shortEdge = () => Math.min(cssSize.width, cssSize.height)

  const gestures = createTouchGestures({
    panRadius:    () => shortEdge() * TOUCH_PAN_RADIUS,
    pinchRange:   () => shortEdge() * PINCH_RANGE,
    currentBlend: () => lastFrame?.cameraBlend ?? 0,
  })

  // The visor scans itself in on mount. `mountedAt` is the first frame's clock
  // reading rather than 0, because a scene mounted mid-session inherits an
  // elapsed time that is already well past the transition window.
  const visorReveal              = createHudReveal(false)

  /**
   * Blocking layers and the touch controls each carry their own arrival.
   *
   * Separately, because they open and close for unrelated reasons — a finish
   * screen must not restart the touch rail's wipe, and the rail must stay put
   * while a popover comes and goes over it.
   */
  const modalReveal = createHudReveal(false)
  const touchReveal = createHudReveal(false)
  let mountedAt: number | null   = null

  /** The data a closing modal was drawn from — see `DrawHudOverlayOptions.modalData`. */
  let modalData: HudData | null = null

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

  const viewAspect = (camera: THREE.Camera): number => camera instanceof THREE.PerspectiveCamera
    ? camera.aspect
    : canvas.clientWidth / Math.max(canvas.clientHeight, 1)

  /**
   * Put both roots where the camera says they go.
   *
   * EVERY rendered frame, and pure maths on purpose — no DOM read, no canvas
   * resize, no draw. The visor is anchored in world space to a camera that is
   * riding the ship's hover bob, so a frame in which the anchor is not moved
   * is a frame in which the HUD slides against the view. Repaints are the
   * expensive part and they are throttled separately; this is a handful of
   * quaternion copies.
   */
  function syncStation (frame: HudFrame): void {
    const camera = frame.camera
    const aspect = viewAspect(camera)
    const fov    = camera instanceof THREE.PerspectiveCamera ? camera.fov : HUD_REFERENCE_FOV

    // Seated the visor is worn; in chase it is a hologram the ship carries.
    // `hudStation` is the single continuous function between the two, so the
    // pinch blend moves the anchor as well as the depth.
    hudStation(station, frame)
    visorRoot.position.copy(station.position)
    visorRoot.quaternion.copy(station.quaternion)
    visorRoot.scale.set(station.scale.x, station.scale.y, 1)
    visorRoot.updateMatrixWorld(true)

    const halfHeight = Math.tan(THREE.MathUtils.degToRad(fov * 0.5)) * OVERLAY_DISTANCE
    overlayRoot.position.copy(camera.position)
    overlayRoot.quaternion.copy(camera.quaternion)
    overlayRoot.translateZ(-OVERLAY_DISTANCE)
    overlayMesh.scale.set(halfHeight * aspect, halfHeight, 1)
    overlayRoot.updateMatrixWorld(true)
  }

  /**
   * Reconcile the overlay's raster with the viewport it is stretched over.
   *
   * Kept out of `syncStation` because both halves of it read layout —
   * `getBoundingClientRect` and the safe-area probe force style resolution —
   * and neither answer can change without a resize. Called on the frames that
   * actually repaint.
   */
  function syncSurface (frame: HudFrame): void {
    // Match the viewport's aspect EXACTLY. The plane is scaled to `aspect`; a
    // canvas of any other shape is stretched non-uniformly across it, which is
    // what made the sticks ellipses and every `canvas.width * k` size mean
    // something different on each axis.
    const aspect      = viewAspect(frame.camera)
    const height      = Math.round(Math.sqrt(OVERLAY_PIXELS / Math.max(aspect, 0.01)))
    const targetWidth = Math.max(1, Math.round(height * aspect))
    if (overlay.canvas.width !== targetWidth || overlay.canvas.height !== height) {
      overlay.canvas.width  = targetWidth
      overlay.canvas.height = height
      overlayDirty          = true
    }

    const rect = canvas.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0 &&
        (cssSize.width !== rect.width || cssSize.height !== rect.height)) {
      cssSize.width  = rect.width
      cssSize.height = rect.height
      insets         = readSafeAreaInsets()
      overlayDirty   = true
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
      insets,
      cssSize,
      held:         heldActions,
      modalPhase:   modalReveal.value(frame.elapsed),
      modalData,
      modalClosing: modalReveal.closing(),
      touchPhase:   touchReveal.value(frame.elapsed),
      touchDebug:   forced === '1' ? touchDebugLine(frame) : null,
    })
    overlayDirty = false
  }

  /**
   * Every input to the rail's visibility, on one line.
   *
   * Reported rather than deduced: the four conditions are read here, at the
   * moment the overlay is drawn, so the line cannot disagree with what the
   * frame actually did.
   */
  function touchDebugLine (frame: HudFrame): string {
    const age = mountedAt === null ? -1 : frame.elapsed - mountedAt
    return [
      `on=${isTouch ? 1 : 0}`,
      `forced=${forced ?? '-'}`,
      `coarse=${coarse.matches ? 1 : 0}`,
      `phase=${touchReveal.value(frame.elapsed).toFixed(2)}`,
      `age=${age.toFixed(2)}`,
      `block=${lastBlocking ? 1 : 0}`,
      `css=${Math.round(cssSize.width)}x${Math.round(cssSize.height)}`,
      `ovl=${overlay.canvas.width}x${overlay.canvas.height}`,
      `ins=${Math.round(insets.top)}/${Math.round(insets.bottom)}`,
    ].join(' ')
  }

  function update (frame: HudFrame): void {
    if (disposed || hidden)
      return

    lastFrame = frame
    syncStation(frame)

    if (mountedAt === null) {
      mountedAt = frame.elapsed
      visorReveal.set(true, frame.elapsed)
    }

    const revealPhase = visorReveal.value(frame.elapsed)
    tickHudPanelMesh(panelMesh, frame.elapsed, revealPhase)
    // The visor is still assembling, so it needs a frame every frame — the
    // panel cadence would draw the wipe in four steps.
    if (revealPhase < 1)
      overlayDirty = true

    if (frame.telemetry.crashSeq !== lastCrashSeq) {
      lastCrashSeq = frame.telemetry.crashSeq
      crashUntil   = frame.elapsed + 0.22
      overlayDirty = true
    }

    // The renderer's quality tier budgets HUD REPAINTS, so it lands here rather
    // than on the caller's update rate: it lowers the two texture cadences and
    // never the pose above.
    const drawPeriod  = 1 / THREE.MathUtils.clamp(frame.drawHz, 10, 60)
    const panelPeriod = Math.max(basePanelPeriod, drawPeriod)

    if (frame.elapsed - panelDrawAt >= panelPeriod) {
      lastData    = source.read()
      panelDrawAt = frame.elapsed
      expireToasts(lastData, frame.elapsed)
      drawPanels(lastData, frame)
      overlayDirty = true
    }

    const blocking = isHudBlockingOverlay(lastData)
    lastBlocking   = blocking
    modalReveal.set(blocking, frame.elapsed)
    if (blocking)
      modalData = lastData
    else if (!modalReveal.live(frame.elapsed))
      modalData = null

    // Two gates, and both are about the same frame rather than about the
    // device: the rail follows the visor in by 87 ms so the mount is not one
    // wall of motion, and it steps aside for a full-screen layer, which draws
    // over it and would otherwise be tapped through. Nothing else can withhold
    // it — a rail whose existence depended on the state of a layer it has
    // nothing to do with is how it came to be missing entirely.
    //
    // The stagger waits on the CLOCK, not on `revealPhase`. Same moment to the
    // millisecond as the old gate, which was the EASED phase passing 0.5:
    // `1 - (1 - t)³` crosses a half at t ≈ 0.206, not halfway through.
    const staggered = mountedAt !== null && frame.elapsed - mountedAt >= TOUCH_STAGGER_S
    touchReveal.set(isTouch && staggered && !blocking, frame.elapsed)

    // A layer mid-transition needs every frame. `isHudBlockingOverlay` alone
    // would stop redrawing the moment a modal closed and freeze its exit wipe
    // on screen.
    const transitioning = modalReveal.live(frame.elapsed) && modalReveal.value(frame.elapsed) < 0.999 ||
      touchReveal.value(frame.elapsed) < 0.999 && touchReveal.live(frame.elapsed)
    if (transitioning)
      overlayDirty = true

    // A rail that is merely PRESENT is not live content — it is a static plate
    // with a rolling scanline, and it is now present always, so keying this on
    // `isTouch` would pin the largest surface in the HUD at 30 Hz on every
    // machine forever. What earns the faster cadence is a thumb actually on it,
    // which `activePointers` already reports.
    const overlayLive = activePointers.size > 0 || transitioning ||
      modalReveal.live(frame.elapsed) ||
      frame.elapsed < crashUntil ||
      lastData.mode === 'race' && lastData.race.status === 'countdown' ||
      lastData.mode === 'battle' && lastData.battle.toasts.length > 0
    const period = Math.max(overlayLive ? HUD_OVERLAY_PERIOD : panelPeriod, drawPeriod)

    // `overlayDirty` says the surface is WRONG, not that redrawing it is free —
    // and things set it every frame (an arriving visor, any layer
    // mid-transition). Without the second clause it short-circuits the cadence
    // outright, and the tier's budget stops meaning anything for the duration.
    const due = overlayDirty || frame.elapsed - overlayDrawAt >= period
    if (due && frame.elapsed - overlayDrawAt >= drawPeriod) {
      overlayDrawAt = frame.elapsed
      syncSurface(frame)
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
    if (!action)
      return

    if (down)
      heldActions.add(action)
    else
      heldActions.delete(action)

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
      case 'strafe-left':
      case 'strafe-right':
      case 'airbrake':
        // Shared with the left stick's axes — composed, never assigned.
        syncTouchAxes()
        break
      default:
        break
    }
  }

  /**
   * Fold the sticks and the shoulder rail into the shared control surface.
   *
   * Both write the same two axes: the left stick's X is lateral thrust and its
   * Y gates throttle and brake, and the rail's buttons are the same lateral
   * thrust and the air brake. Either one assigning directly means whichever
   * fires last wins, and letting go of a button zeroes an axis a thumb is still
   * holding. One place composes them, and it is the only writer.
   *
   * The air brake is brake WITHOUT reverse. `S` on the keyboard sets both, but
   * that is reverse thrust: the panels deploy off `brake` alone
   * (`vehicle-step.ts`), which is what a drag device does.
   */
  function syncTouchAxes (): void {
    const railStrafe = (heldActions.has('strafe-right') ? -1 : 0) +
      (heldActions.has('strafe-left') ? 1 : 0)
    const stickStrafe = shapeHudAxis(stickX.move)
    const forward     = shapeHudAxis(-stickY.move)

    controls.strafe   = Math.max(-1, Math.min(1, stickStrafe + railStrafe))
    controls.throttle = forward > HUD_AXIS_GATE
    // Commanded thrust is the stick's own deflection past the gate, remapped so
    // the gauge starts at the point the ship actually starts pushing.
    controls.throttleAxis = controls.throttle
      ? (forward - HUD_AXIS_GATE) / (1 - HUD_AXIS_GATE)
      : 0

    const stickBrake = forward < -HUD_AXIS_GATE
    controls.reverse = stickBrake
    controls.brake   = stickBrake || heldActions.has('airbrake')
    overlayDirty     = true
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

    if (stick === 'move') {
      syncTouchAxes()
      return
    }

    controls.steer = shapeHudAxis(x)
    controls.pitch = shapeHudAxis(-y)
    overlayDirty   = true
  }

  /**
   * Full-deflection distance for a stick, CSS pixels.
   *
   * Taken from the SAME layout that drew the ring, converted back to CSS. It
   * used to be an independent `max(42, min(w, h) * 0.12)`, so on a tablet the
   * knob pinned at 92 px inside a 112 px ring — the thumb ran out of gain
   * before it ran out of pad.
   */
  function stickTravelCss (): number {
    if (!lastData)
      return 60

    const layout = touchLayout({
      width:     overlay.canvas.width,
      height:    overlay.canvas.height,
      cssWidth:  cssSize.width,
      cssHeight: cssSize.height,
      insets,
      mode:      lastData.mode,
    })
    return Math.max(24, layout.stickTravel / Math.max(layout.pixelScale, 1e-3))
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
    if (!region) {
      // A finger on empty canvas is a gesture, not a miss. Mouse and pen fall
      // through to `input.ts`, where a drag already steers.
      if (event.pointerType === 'touch') {
        event.preventDefault()
        tryCapture(event)
        gestures.down(event.pointerId, event.clientX, event.clientY)
        applyGestures()
      }
      return
    }

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
    else if (region.kind === 'slider')
      applySlider(region, event.clientX)
  }

  const onPointerMove = (event: PointerEvent) => {
    const active = activePointers.get(event.pointerId)
    if (!active) {
      if (event.pointerType === 'touch') {
        if (gestures.active) {
          event.preventDefault()
          event.stopImmediatePropagation()
          gestures.move(event.pointerId, event.clientX, event.clientY)
          applyGestures()
        }
        return
      }
      setHover(event.clientX, event.clientY)
      return
    }

    event.preventDefault()
    event.stopImmediatePropagation()
    active.lastX = event.clientX
    active.lastY = event.clientY

    if (active.region.kind === 'stick' && active.region.stick) {
      // Origin is the PRESS point, not the pad's centre: a thumb landing near
      // the gate used to clamp the axis before it had moved at all.
      const radius = stickTravelCss()
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

  /** Free-pointer gestures onto the shared control surface. */
  function applyGestures (): void {
    const sample  = gestures.sample()
    controls.panX = sample.panX
    controls.panY = sample.panY

    if (sample.blend !== null) {
      controls.viewBlend = sample.blend
      controls.viewBlendSeq++
    }
  }

  const endPointer = (event: PointerEvent, cancelled = false) => {
    const active = activePointers.get(event.pointerId)
    if (!active) {
      if (gestures.active) {
        gestures.up(event.pointerId)
        if (!gestures.active) {
          // Touch fires no `pointerleave`, so without this the camera stays
          // yawed at whatever the last finger left it at.
          controls.panX = 0
          controls.panY = 0
        }
        else
          applyGestures()
      }
      return
    }

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
      heldActions.clear()
      gestures.clear()
      if (isTouch) {
        controls.steer        = 0
        controls.strafe       = 0
        controls.pitch        = 0
        controls.throttle     = false
        controls.throttleAxis = 0
        controls.brake        = false
        controls.reverse      = false
        controls.panX         = 0
        controls.panY         = 0
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


// perf: nine draw calls total; panels upload at up to 20 hz and the overlay at up to 30 hz,
// both floored by the quality tier's `drawHz`. The POSE is synced every frame and draws nothing.
