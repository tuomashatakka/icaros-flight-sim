import { TEAM_COLORS } from 'Ψarena'
import type { Controls } from '../input'
import { chamferPath, drawPlate, drawPlateLabel, drawScanlines, drawStick } from './chrome'
import type { Rect } from './chrome'
import { HudPanel } from './panel'
import { drawHudSight } from './sight'
import { touchLayout } from './touch-layout'
import type { SafeAreaInsets } from './touch-layout'
import { formatHudRaceTime } from './interaction'
import { HUD_COLORS as COLORS, HUD_FONT as FONT, HUD_SURFACES as SURFACES, HUD_TUNING_SPECS } from './tokens'
import { clipReveal, revealAlpha } from './transition'
import type { BattleHudData, HudActionId, HudData, HudFrame, RaceHudData } from './types'


const TAU = Math.PI * 2

/** The drawing surface in CSS pixels — what a finger and an inset are measured in. */
type CssSizeType = { width: number; height: number }

/**
 * A modal surface, in the same cut-corner language as the visor's facets.
 *
 * `phase` scans it in. The caller has already installed the clip via
 * `beginModal`, so this only has to carry the alpha.
 */
function fillPanel (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  accent: string = COLORS.cyan,
  phase = 1
): void {
  const rect = { x, y, width, height }
  context.save()
  chamferPath(context, rect, Math.min(width, height) * 0.06)
  context.fillStyle   = SURFACES.inkSolid
  context.globalAlpha = revealAlpha(phase)
  context.fill()
  context.restore()
  drawPlate(context, rect, { accent, chamfer: 0.06, alpha: 0.9 * revealAlpha(phase) })
}

/**
 * Open a modal's transition.
 *
 * Clips to the arrived part of the surface and draws the leading edge, so the
 * panel is scanned in rather than cut in. Always paired with `context.restore`.
 */
function beginModal (
  context: CanvasRenderingContext2D,
  rect: Rect,
  phase: number,
  accent: string = COLORS.cyan
): void {
  context.save()
  clipReveal(context, {
    x:      rect.x - 24,
    y:      rect.y - 24,
    width:  rect.width + 48,
    height: rect.height + 48,
  }, phase, accent)
}

function overlayText (
  context: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  size: number,
  color: string = COLORS.white,
  align: CanvasTextAlign = 'center',
  weight = 600
): void {
  context.font         = `${weight} ${size}px ${FONT}`
  context.textAlign    = align
  context.textBaseline = 'middle'
  context.fillStyle    = color
  context.fillText(value, x, y)
}

type OptionsType = {
  id:        string;
  label:     string;
  x:         number;
  y:         number;
  width:     number;
  height:    number;
  action:    HudActionId;
  kind?:     'button' | 'hold';
  color?:    string;
  active?:   boolean;
  disabled?: boolean;
}

function overlayButton (
  overlay: HudPanel,
  options: OptionsType
): void {
  const { context } = overlay
  const color       = options.color ?? COLORS.cyan
  const rect        = { x: options.x, y: options.y, width: options.width, height: options.height }

  drawPlate(context, rect, {
    accent:   color,
    active:   options.active ?? false,
    hovered:  overlay.hovered === options.id,
    disabled: options.disabled,
  })
  drawPlateLabel(context, options.label, rect.x + rect.width * 0.5, rect.y + rect.height * 0.5, {
    size:  Math.max(11, rect.height * 0.24),
    color: options.disabled ? SURFACES.edgeDim : color,
    alpha: options.disabled ? 0.5 : 0.9,
  })

  if (options.disabled)
    return

  overlay.region({
    id:     options.id,
    kind:   options.kind ?? 'button',
    x:      rect.x,
    y:      rect.y,
    width:  rect.width,
    height: rect.height,
    action: options.action,
  })
}

/**
 * The rectangle a modal may occupy, inside the device's safe area.
 *
 * The modals sized themselves off the raw canvas, so on a phone they ran under
 * the notch and the home indicator at both ends.
 */
function modalRect (
  overlay: HudPanel,
  insets: SafeAreaInsets,
  cssSize: CssSizeType,
  maxWidth: number,
  maxHeight: number
): Rect {
  const { canvas } = overlay
  const scale      = Math.min(canvas.width / Math.max(cssSize.width, 1), canvas.height / Math.max(cssSize.height, 1))
  const left       = insets.left * scale
  const top        = insets.top * scale
  const availW     = canvas.width - left - insets.right * scale
  const availH     = canvas.height - top - insets.bottom * scale
  const width      = Math.min(maxWidth, availW - 32)
  const height     = Math.min(maxHeight, availH - 32)

  return {
    x: left + (availW - width) * 0.5,
    y: top + (availH - height) * 0.5,
    width,
    height,
  }
}

type FooterButton = {
  id:     string;
  label:  string;
  action: HudActionId;
  color:  string;
}

/**
 * A modal's footer row, sized to the modal.
 *
 * These were three fixed 150 px buttons at three hard-coded offsets inside a
 * panel that was already responsive. On a phone the panel came out 388 px wide
 * and they overlapped each other by about 63 px; `drawRaceFinish` went further
 * and computed a NEGATIVE width below ~137 px. Below a threshold the row
 * stacks, which is the only thing that fits a portrait phone.
 */
function footerButtons (
  overlay: HudPanel,
  panelX: number,
  rowY: number,
  panelWidth: number,
  buttons: readonly FooterButton[]
): void {
  const inset   = Math.min(32, panelWidth * 0.06)
  const gap     = 12
  const usable  = panelWidth - inset * 2
  const stacked = usable / buttons.length < 132
  const height  = stacked ? 42 : 46

  buttons.forEach((button, index) => {
    const width = stacked ? usable : (usable - gap * (buttons.length - 1)) / buttons.length
    const x     = panelX + inset + (stacked ? 0 : index * (width + gap))
    // Stacking grows upward from the footer line so the row's bottom edge stays
    // where the modal reserved space for it.
    const y     = stacked ? rowY - (buttons.length - 1 - index) * (height + 8) : rowY
    overlayButton(overlay, { ...button, x, y, width, height })
  })
}

export function isHudBlockingOverlay (data: HudData): boolean {
  if (data.mode === 'race')
    return data.tuningOpen || data.race.status === 'finished'
  return data.battle.status === 'finished' || data.battle.status === 'error'
}
function drawToasts (overlay: HudPanel, data: HudData, frame: HudFrame): void {
  if (data.mode !== 'battle' || data.battle.toasts.length === 0)
    return

  const { context, canvas } = overlay
  const width               = Math.min(canvas.width * 0.54, 620)
  const height              = Math.max(34, canvas.height * 0.055)
  data.battle.toasts.slice(0, 3).forEach((toast, index) => {
    const text          = toast.split('|').slice(1)
      .join('|')
    const x             = (canvas.width - width) * 0.5
    const y             = canvas.height * 0.08 + index * (height + 8)
    context.fillStyle   = 'rgba(3, 9, 15, .86)'
    context.strokeStyle = COLORS.cyan
    context.globalAlpha = 0.92 - index * 0.2
    context.fillRect(x, y, width, height)
    context.strokeRect(x, y, width, height)
    overlayText(context, text.toUpperCase(), canvas.width * 0.5, y + height * 0.5, Math.max(10, height * 0.3), COLORS.white)
    overlay.region({ id: `toast:${toast}`, kind: 'button', x, y, width, height })
  })
  context.globalAlpha = 1
  void frame
}

function drawCountdown (overlay: HudPanel, data: HudData): void {
  const { context, canvas } = overlay
  let label         = ''
  let color: string = COLORS.cyan
  if (data.mode === 'race') {
    if (data.race.status === 'countdown')
      label = String(Math.max(1, Math.ceil(data.clocks.countdown)))
    else if (data.race.status === 'racing' && data.clocks.elapsed < 1) {
      label = 'GO'
      color = COLORS.amber
    }
  }
  else if (data.battle.status === 'countdown')
    label = String(Math.max(1, Math.ceil(data.battle.countdown)))

  if (!label)
    return
  context.shadowColor = color
  context.shadowBlur  = 32
  overlayText(context, label, canvas.width * 0.5, canvas.height * 0.5, Math.min(canvas.width, canvas.height) * 0.22, color, 'center', 700)
  context.shadowBlur = 0
}

function drawRaceFinish (
  overlay: HudPanel,
  data: RaceHudData,
  insets: SafeAreaInsets,
  cssSize: CssSizeType,
  phase: number
): void {
  const { context, canvas } = overlay
  context.fillStyle         = `rgba(1, 4, 8, ${0.72 * phase})`
  context.fillRect(0, 0, canvas.width, canvas.height)

  const { x, y, width, height } = modalRect(overlay, insets, cssSize, 620, 520)
  const midX                    = x + width * 0.5
  beginModal(context, { x, y, width, height }, phase)
  fillPanel(context, x, y, width, height, COLORS.cyan, phase)
  overlayText(context, 'COURSE COMPLETE', midX, y + 58, 28, COLORS.cyan)
  overlayText(context, `TOTAL ${formatHudRaceTime(data.clocks.elapsed)}`, midX, y + 122, 20)
  overlayText(context, `BEST ${data.race.bestLap === null ? '--:--.---' : formatHudRaceTime(data.race.bestLap)}`, midX, y + 158, 17, COLORS.amber)

  data.race.lapTimes.slice(0, 5).forEach((time, index) => {
    overlayText(context, `LAP ${index + 1}  ${formatHudRaceTime(time)}`, midX, y + 208 + index * 28, 14, COLORS.white)
  })

  footerButtons(overlay, x, y + height - 82, width, [
    { id: 'race-again', label: 'race again', action: 'race-again', color: COLORS.cyan },
    { id: 'finish-menu', label: 'menu', action: 'menu', color: COLORS.magenta },
  ])
  context.restore()
}

function drawBattleFinish (
  overlay: HudPanel,
  data: BattleHudData,
  insets: SafeAreaInsets,
  cssSize: CssSizeType,
  phase: number
): void {
  const { context, canvas } = overlay
  context.fillStyle         = `rgba(1, 4, 8, ${0.76 * phase})`
  context.fillRect(0, 0, canvas.width, canvas.height)

  const { x, y, width, height } = modalRect(overlay, insets, cssSize, 860, 570)
  beginModal(context, { x, y, width, height }, phase)
  fillPanel(context, x, y, width, height, COLORS.cyan, phase)
  overlayText(context, 'MATCH OVER', x + width * 0.5, y + 52, 28, COLORS.white)
  overlayText(context, `${data.battle.scores.red}`, x + width * 0.25, y + 100, 34, TEAM_COLORS.red)
  overlayText(context, `${data.battle.scores.blue}`, x + width * 0.75, y + 100, 34, TEAM_COLORS.blue)

  const teams = [ 'red', 'blue' ] as const
  teams.forEach((team, teamIndex) => {
    const centerX = x + width * (teamIndex === 0 ? 0.25 : 0.75)
    overlayText(context, team.toUpperCase(), centerX, y + 136, 14, TEAM_COLORS[team])
    data.battle.roster.filter(player => player.team === team).slice(0, 7)
      .forEach((player, index) => {
        overlayText(context, `${player.name.toUpperCase()}  ${player.kills}/${player.deaths}`, centerX, y + 182 + index * 30, 13, COLORS.white)
      })
  })

  footerButtons(overlay, x, y + height - 74, width, [
    { id: 'battle-finish-menu', label: 'return to menu', action: 'menu', color: COLORS.cyan },
  ])
  context.restore()
}

function drawBattleError (
  overlay: HudPanel,
  data: BattleHudData,
  insets: SafeAreaInsets,
  cssSize: CssSizeType,
  phase: number
): void {
  const { context, canvas } = overlay
  context.fillStyle         = `rgba(1, 4, 8, ${0.78 * phase})`
  context.fillRect(0, 0, canvas.width, canvas.height)

  const { x, y, width, height } = modalRect(overlay, insets, cssSize, 620, 260)
  beginModal(context, { x, y, width, height }, phase, COLORS.red)
  fillPanel(context, x, y, width, height, COLORS.red, phase)
  overlayText(context, 'CONNECTION FAILURE', x + width * 0.5, y + 58, 24, COLORS.red)
  overlayText(context, (data.battle.error ?? 'connection lost').toUpperCase(), x + width * 0.5, y + 112, 14, COLORS.white)
  footerButtons(overlay, x, y + height - 68, width, [
    { id: 'battle-error-menu', label: 'menu', action: 'menu', color: COLORS.red },
  ])
  context.restore()
}

function drawTuning (
  overlay: HudPanel,
  data: RaceHudData,
  frame: HudFrame,
  copyUntil: number,
  insets: SafeAreaInsets,
  cssSize: CssSizeType,
  phase: number
): void {
  const { context, canvas } = overlay
  context.fillStyle         = `rgba(1, 4, 8, ${0.8 * phase})`
  context.fillRect(0, 0, canvas.width, canvas.height)

  const { x, y, width, height } = modalRect(overlay, insets, cssSize, 900, 700)
  beginModal(context, { x, y, width, height }, phase)
  fillPanel(context, x, y, width, height, COLORS.cyan, phase)
  overlayText(context, 'SHIP PHYSICS · LIVE TUNING', x + 34, y + 42, 20, COLORS.cyan, 'left')

  // Below this the label column and the track cannot both fit on one line, so
  // the label moves above its own full-width track instead of being squeezed
  // into 200 px next to it.
  const narrow    = width < 520
  const labelCol  = narrow ? 0 : Math.min(230, width * 0.34)
  const rowHeight = narrow ? 56 : 40
  const rowStart  = y + 96 + (narrow ? 12 : 0)
  const rowGap    = Math.min(narrow ? 64 : 62, (height - 190) / HUD_TUNING_SPECS.length)
  const sliderX   = x + 36 + labelCol
  const sliderW   = Math.max(80, x + width - 36 - sliderX)

  HUD_TUNING_SPECS.forEach((spec, index) => {
    const rowY   = rowStart + index * rowGap
    const trackY = narrow ? rowY + 16 : rowY
    const value  = data.tuning[spec.key]
    const ratio  = (value - spec.min) / (spec.max - spec.min)
    overlayText(context, spec.label.toUpperCase(), x + 36, rowY, 13, COLORS.white, 'left')
    overlayText(context, String(value), x + width - 36, rowY, 13, COLORS.amber, 'right')
    context.fillStyle = SURFACES.track
    context.fillRect(sliderX, trackY - 5, sliderW, 10)
    context.fillStyle = COLORS.cyan
    context.fillRect(sliderX, trackY - 5, sliderW * ratio, 10)
    context.strokeStyle = SURFACES.edge
    context.strokeRect(sliderX, trackY - 5, sliderW, 10)
    drawPlate(context, { x: sliderX + sliderW * ratio - 7, y: trackY - 13, width: 14, height: 26 }, {
      accent:  COLORS.white,
      active:  true,
      chamfer: 0.3,
      plain:   true,
    })
    overlay.region({
      id:     `tuning:${spec.key}`,
      kind:   'slider',
      x:      sliderX,
      y:      trackY - rowHeight * 0.5,
      width:  sliderW,
      height: rowHeight,
      tuning: spec,
    })
  })

  footerButtons(overlay, x, y + height - 68, width, [
    { id: 'tuning-close', label: 'close', action: 'tuning-toggle', color: COLORS.cyan },
    { id: 'tuning-reset', label: 'reset', action: 'tuning-reset', color: COLORS.amber },
    { id: 'tuning-copy', label: frame.elapsed < copyUntil ? 'copied' : 'copy as ts', action: 'tuning-copy', color: COLORS.magenta },
  ])
  context.restore()
}

const ACCENTS = {
  cyan:    COLORS.cyan,
  magenta: COLORS.magenta,
  amber:   COLORS.amber,
  violet:  COLORS.violet,
  green:   COLORS.green,
} as const

/**
 * The on-screen controls, in the visor's own language.
 *
 * Geometry comes from `touchLayout` and nothing here invents a coordinate:
 * that record is the single source for the drawing AND — because regions are
 * emitted while drawing — for the hitboxes, so the two cannot drift.
 */
function drawTouchControls (
  overlay: HudPanel,
  data: HudData,
  frame: HudFrame,
  controls: Controls,
  insets: SafeAreaInsets,
  cssSize: CssSizeType,
  stickX: Record<'move' | 'aim', number>,
  stickY: Record<'move' | 'aim', number>,
  held: ReadonlySet<HudActionId>,
  phase: number
): void {
  const { context, canvas } = overlay
  const layout              = touchLayout({
    width:     canvas.width,
    height:    canvas.height,
    cssWidth:  cssSize.width,
    cssHeight: cssSize.height,
    insets,
    mode:      data.mode,
  })

  // The controls slide up from the edge they live on as they arrive, so the
  // rail comes in from the sides and the thumb cluster from the bottom.
  const rise = (1 - phase) * canvas.height * 0.06

  context.save()
  context.globalAlpha = revealAlpha(phase)
  context.translate(0, rise)

  for (const stick of layout.sticks) {
    drawStick(context, stick.centerX, stick.centerY, stick.radius, {
      offsetX: stickX[stick.stick],
      offsetY: stickY[stick.stick],
      engaged: Math.hypot(stickX[stick.stick], stickY[stick.stick]) > 0.02,
      label:   stick.label,
      accent:  COLORS.cyan,
    })
    overlay.region({
      id:     `stick:${stick.stick}`,
      kind:   'stick',
      stick:  stick.stick,
      x:      stick.centerX - stick.radius,
      y:      stick.centerY - stick.radius,
      width:  stick.radius * 2,
      height: stick.radius * 2,
    })
  }

  for (const button of layout.buttons) {
    const accent = ACCENTS[button.accent]
    const active = button.hold
      ? held.has(button.action) || liveHold(button.action, controls)
      : false

    drawPlate(context, button.rect, { accent, active })
    drawScanlines(context, button.rect, frame.elapsed, accent)
    drawPlateLabel(
      context,
      button.label,
      button.rect.x + button.rect.width * 0.5,
      button.rect.y + button.rect.height * 0.5,
      { size: Math.max(11, Math.min(button.rect.height * 0.26, button.rect.width * 0.19)), color: accent }
    )
    overlay.region({
      id:     button.id,
      kind:   button.hold ? 'hold' : 'button',
      x:      button.rect.x,
      // Regions are the SETTLED positions, not the animated ones: a control
      // that has to be chased while it slides in is worse than one that is
      // tappable a beat before it looks ready.
      y:      button.rect.y,
      width:  button.rect.width,
      height: button.rect.height,
      action: button.action,
    })
  }

  context.restore()
}

/**
 * Whether a hold action is engaged right now.
 *
 * Read off `Controls` where it exists there, so a key and a thumb light the
 * same plate. The lateral and brake axes are shared with the sticks, so those
 * fall back to the pressed set rather than claiming a stick's deflection.
 */
function liveHold (action: HudActionId, controls: Controls): boolean {
  switch (action) {
    case 'boost':
      return controls.boost
    case 'fire-primary':
      return controls.fire
    case 'fire-secondary':
      return controls.fireSecondary
    default:
      return false
  }
}

export type DrawHudOverlayOptions = {
  overlay:    HudPanel;
  data:       HudData;
  frame:      HudFrame;
  crashUntil: number;
  copyUntil:  number;
  isTouch:    boolean;
  controls:   Controls;
  stickX:     Record<'move' | 'aim', number>;
  stickY:     Record<'move' | 'aim', number>;

  /** Safe-area insets in CSS pixels, and the surface they were measured on. */
  insets:  SafeAreaInsets;
  cssSize: { width: number; height: number };

  /** Hold actions with a finger on them, for the ones `Controls` cannot report. */
  held: ReadonlySet<HudActionId>;

  /** Arrival phase of whichever blocking layer is up, 0..1. */
  modalPhase: number;

  /**
   * The data the blocking layer was drawn from.
   *
   * Retained by the caller across the close: by the time a popover is
   * dismissed, `tuningOpen` is already false and `data` no longer describes the
   * thing that is still on screen finishing its exit.
   */
  modalData: HudData | null;

  /** True while the blocking layer is on its way out rather than in. */
  modalClosing: boolean;

  /** Arrival phase of the touch controls, 0..1. */
  touchPhase: number;

  /**
   * A line describing why the touch rail is or is not on screen.
   *
   * Only set under `?touch=1`, and drawn over everything. A rail that fails to
   * appear on someone else's phone is otherwise undiagnosable from here: the
   * decision has four inputs, a bug report can only report the output, and
   * there is no console on a handset worth asking anyone to open.
   */
  touchDebug?: string | null;
}

export function drawHudOverlay ({
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
  held,
  modalPhase,
  modalData,
  modalClosing,
  touchPhase,
  touchDebug,
}: DrawHudOverlayOptions): void {
  const { context, canvas } = overlay
  const { width, height }   = canvas

  overlay.regions.length = 0
  context.clearRect(0, 0, width, height)

  if (frame.elapsed < crashUntil) {
    const glow = context.createRadialGradient(width * 0.5, height * 0.5, height * 0.18, width * 0.5, height * 0.5, height * 0.72)
    glow.addColorStop(0, 'rgba(255, 35, 85, 0)')
    glow.addColorStop(1, 'rgba(255, 35, 85, .58)')
    context.fillStyle = glow
    context.fillRect(0, 0, width, height)
  }

  if (data.mode === 'battle' && data.battle.myHealth / Math.max(1, data.battle.maxHealth) < 0.3) {
    const alpha         = 0.12 + Math.sin(frame.elapsed * 7) * 0.05
    context.strokeStyle = `rgba(255, 42, 92, ${alpha})`
    context.lineWidth   = Math.max(18, height * 0.035)
    context.strokeRect(0, 0, width, height)
  }

  drawToasts(overlay, data, frame)

  const modal = modalPhase > 0.001 ? modalData : null

  // A layer on its way out is a picture, not a control. Without this a
  // dismissed popover keeps swallowing taps for the length of its exit.
  const regionMark = overlay.regions.length

  if (modal?.mode === 'race' && modal.tuningOpen)
    drawTuning(overlay, modal, frame, copyUntil, insets, cssSize, modalPhase)
  else if (modal?.mode === 'race' && modal.race.status === 'finished')
    drawRaceFinish(overlay, modal, insets, cssSize, modalPhase)
  else if (modal?.mode === 'battle' && modal.battle.status === 'finished')
    drawBattleFinish(overlay, modal, insets, cssSize, modalPhase)
  else if (modal?.mode === 'battle' && modal.battle.status === 'error')
    drawBattleError(overlay, modal, insets, cssSize, modalPhase)
  else
    drawLiveLayers()

  if (modalClosing)
    overlay.regions.length = regionMark

  // Last, and outside every branch above, so it reports even when the thing it
  //  is reporting on drew nothing at all.
  if (touchDebug) {
    context.save()
    context.textAlign    = 'left'
    context.textBaseline = 'top'

    // Sized to FIT, not to a fraction of a dimension. A portrait canvas is
    //  twice as tall as it is wide, so a height-derived size ran the line off
    //  the edge on exactly the phones this is meant to be read on.
    const size   = Math.max(9, Math.min(width * 0.026, (width - 24) / (touchDebug.length * 0.62)))
    context.font = `500 ${size.toFixed(1)}px ui-monospace, monospace`

    context.fillStyle = 'rgba(0, 0, 0, .78)'
    context.fillRect(0, 0, width, size * 1.8)
    context.fillStyle = '#7dffe0'
    context.fillText(touchDebug, 12, size * 0.4)
    context.restore()
  }

  overlay.texture.needsUpdate = true

  function drawLiveLayers (): void {
    // The sight is screen space by necessity — see `hud/sight.ts`. It draws
    // under the countdown and the touch controls so neither is ever occluded
    // by a reticle that happens to swing across them.
    drawHudSight(overlay, data, frame)
    drawCountdown(overlay, data)
    if (isTouch && touchPhase > 0.001)
      drawTouchControls(overlay, data, frame, controls, insets, cssSize, stickX, stickY, held, touchPhase)
  }
}
