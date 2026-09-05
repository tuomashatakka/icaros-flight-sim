import type { Rect } from './chrome'
import type { HudActionId, HudMode } from './types'


/**
 * Where every touch control goes, as one function of the frame.
 *
 * The old layout mixed absolute overlay pixels (`canvas.height - 64`, heights
 * of 42 / 50 / 68) with fractions of the canvas (`canvas.width * 0.25`), on a
 * canvas whose aspect had been clamped away from the viewport's — so X and Y
 * scaled by different amounts and nothing kept its designed proportions. It
 * also had no idea the bottom of a phone is behind a home indicator, and the
 * stick's input radius was measured in CSS pixels while its drawn radius was in
 * texture pixels, so on a tablet the knob pinned before the finger reached the
 * ring.
 *
 * Everything here derives from one physical unit and the safe-area insets, and
 * this record is the single source for BOTH the drawing and the hit regions —
 * which stay coupled because regions are still emitted while drawing.
 */

export type SafeAreaInsets = {
  top:    number;
  right:  number;
  bottom: number;
  left:   number;
}

export const NO_INSETS: SafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 }

export type TouchLayoutInput = {

  /** Overlay canvas size, in overlay pixels. */
  width:  number;
  height: number;

  /** The same surface in CSS pixels — what the finger actually moves across. */
  cssWidth:  number;
  cssHeight: number;

  /** Safe-area insets, CSS pixels. */
  insets: SafeAreaInsets;
  mode:   HudMode;
}

export type TouchStick = {
  stick:   'move' | 'aim';
  centerX: number;
  centerY: number;
  radius:  number;
  label:   string;
}

export type TouchButton = {
  id:     string;
  label:  string;
  action: HudActionId;
  rect:   Rect;
  accent: 'cyan' | 'magenta' | 'amber' | 'violet' | 'green';
  hold:   boolean;
}

export type TouchLayout = {
  sticks:  readonly TouchStick[];
  buttons: readonly TouchButton[];

  /**
   * Full deflection distance for a stick, in OVERLAY pixels.
   *
   * Derived from the same unit the ring is drawn at, so the knob reaches the
   * gate exactly when the thumb does.
   */
  stickTravel: number;

  /** Overlay pixels per CSS pixel. Pointer deltas arrive in CSS pixels. */
  pixelScale: number;
}

/**
 * Thumb reach, as a fraction of the short edge.
 *
 * A stick has to be small enough that a thumb anchored at the corner can cover
 * it without the hand shifting, and large enough to resolve small inputs. On a
 * phone this lands around 19 mm of travel.
 */
const STICK_RADIUS = 0.115

/** Minimum tappable size, CSS pixels. Below this a control is a coin toss. */
const MIN_TOUCH_CSS = 44

/**
 * Widest the thumb cluster may get, CSS pixels.
 *
 * In CSS px on purpose. The first attempt at this capped it at a fraction of
 * the overlay's short edge, which looks physical and is not: the raster is
 * sized to a fixed PIXEL BUDGET, so its short edge sits near 720 whatever the
 * display, while `pixelScale` shrinks as the viewport grows. A raster fraction
 * is therefore a constant fraction of the SCREEN — still 266 CSS px per utility
 * button on 1600x900. Reach does not scale with the monitor.
 */
const CLUSTER_MAX_CSS = 300

/**
 * Whether this session gets the touch rail. It does, unless it says otherwise.
 *
 * There is no device sniff any more. The rail used to be gated on `pointer:
 * coarse` or a non-zero `maxTouchPoints`, which meant the controls did not
 * exist at all on a desktop, could not be found by anyone looking for them,
 * and silently disappeared on every machine the sniff read wrong — a
 * convertible reports whichever mode it was last used in, and an iPad in
 * desktop mode reports `fine`. A rail that is sometimes absent is worse than
 * one that is always there: on a mouse it is a set of clickable plates next to
 * the sticks, and it costs nothing to ignore.
 *
 * `forced` is the `?touch` query parameter, honoured in every build: `'0'`
 * turns the rail off, anything else (including absent) leaves it on.
 */
export function wantsTouchControls (forced: string | null): boolean {
  return forced !== '0'
}

type ClusterInput = {
  mode:        HudMode;
  gapLeft:     number;
  gapRight:    number;
  left:        number;
  right:       number;
  bottom:      number;
  margin:      number;
  unit:        number;
  minTouch:    number;
  maxClusterW: number;
  gap:         number;
  buttonH:     number;
  stickY:      number;
  stickRadius: number;
}

/**
 * Where the thumb cluster sits, and how wide it is allowed to get.
 *
 * Extracted so `touchLayout` stays under the statement limit, but it earns its
 * own function anyway: every number here is a consequence of one decision —
 * that a thumb's reach is physical and does not grow with the display.
 */
type ClusterBox = {
  clusterX: number;
  clusterW: number;
  utilityY: number;
}

function clusterBox (input: ClusterInput): ClusterBox {
  const { mode, gapLeft, gapRight, left, right, bottom, margin, unit, minTouch, maxClusterW, gap, buttonH, stickY, stickRadius } = input

  // The widest row the cluster has to hold: three triggers in battle, two
  // utility buttons everywhere. Deciding on THIS rather than on a round number
  // is the point — clamping a column to `minTouch` inside a container too
  // narrow for it is what drove the cluster straight through the sticks.
  const columns = mode === 'battle' ? 3 : 2
  const needed  = minTouch * columns + gap * (columns - 1)

  // On a narrow phone the two sticks leave no usable gap. Above the stick row
  // is worse for the thumbs and the only thing that fits.
  const inGap = gapRight - gapLeft >= needed

  // Capped in THUMB units, then centred in whatever space it was given.
  //
  // The cluster used to be exactly as wide as the gap between the sticks. On a
  // phone that gap is barely wider than the buttons, so it read as designed —
  // but the gap grows with the LONG edge while a thumb does not, and on a 16:9
  // desktop it came out at 790 px, better than half the screen. Now the rail is
  // drawn everywhere, that is not a phone-shaped bug any more, it is every
  // desktop's.
  const available = inGap ? gapRight - gapLeft : right - left - margin * 2
  const reach     = Math.min(unit * 0.62, maxClusterW)
  const clusterW  = Math.min(available, Math.max(needed, reach))
  const home      = inGap ? gapLeft : left + margin

  return {
    clusterW,
    clusterX: home + (available - clusterW) * 0.5,
    utilityY: inGap
      ? bottom - margin - buttonH
      : stickY - stickRadius - gap - buttonH,
  }
}

export function touchLayout (input: TouchLayoutInput): TouchLayout {
  const { width, height, cssWidth, cssHeight, insets, mode } = input

  // Overlay pixels per CSS pixel. The canvas is sized to the viewport's real
  // aspect, so one scale covers both axes.
  const pixelScale = Math.min(width / Math.max(cssWidth, 1), height / Math.max(cssHeight, 1))
  const toPx       = (css: number) => css * pixelScale

  const left   = toPx(insets.left)
  const right  = width - toPx(insets.right)
  const top    = toPx(insets.top)
  const bottom = height - toPx(insets.bottom)

  const shortEdge = Math.min(right - left, bottom - top)
  const unit      = shortEdge
  const margin    = unit * 0.055
  const minTouch  = toPx(MIN_TOUCH_CSS)

  const stickRadius = Math.max(minTouch, unit * STICK_RADIUS)
  const stickY      = bottom - margin - stickRadius
  const buttonH     = Math.max(minTouch, unit * 0.1)
  const gap         = unit * 0.028

  const sticks: TouchStick[] = [
    {
      stick:   'move',
      centerX: left + margin + stickRadius,
      centerY: stickY,
      radius:  stickRadius,
      // Labelled by AXIS, not by a name. Strafe was always on this stick's X
      // and steering on the other one's, which reads as "there is no strafe".
      label:   'thrust / strafe',
    },
    {
      stick:   'aim',
      centerX: right - margin - stickRadius,
      centerY: stickY,
      radius:  stickRadius,
      label:   'steer / aim',
    },
  ]

  const buttons: TouchButton[] = []

  // --- shoulder rail --------------------------------------------------------
  // Edge strips, reachable with an index finger while both thumbs stay on the
  // sticks. Strafe is a lateral thruster and the air brake is a drag panel:
  // both are things you feather WHILE flying, not instead of it.
  const railW   = Math.max(minTouch, unit * 0.11)
  const railH   = Math.max(minTouch * 1.4, unit * 0.22)
  const railTop = top + margin + unit * 0.1

  buttons.push(
    {
      id:     'touch-strafe-left',
      label:  '◀ strafe',
      action: 'strafe-left',
      rect:   { x: left + margin, y: railTop, width: railW, height: railH },
      accent: 'cyan',
      hold:   true,
    },
    {
      id:     'touch-strafe-right',
      label:  'strafe ▶',
      action: 'strafe-right',
      rect:   { x: right - margin - railW, y: railTop, width: railW, height: railH },
      accent: 'cyan',
      hold:   true,
    },
    {
      id:     'touch-airbrake',
      label:  'air brake',
      action: 'airbrake',
      rect:   {
        x:      left + margin,
        y:      railTop + railH + gap,
        width:  railW,
        height: buttonH,
      },
      accent: 'amber',
      hold:   true,
    }
  )

  // --- centre cluster -------------------------------------------------------
  // Between the two sticks by default, stacked upward from the bottom margin,
  // so the thumbs reach it by rolling inward rather than lifting off.
  const gapLeft  = left + margin * 2 + stickRadius * 2
  const gapRight = right - margin * 2 - stickRadius * 2

  const { clusterX, clusterW, utilityY } = clusterBox({
    mode,
    gapLeft,
    gapRight,
    left,
    right,
    bottom,
    margin,
    unit,
    minTouch,
    gap,
    buttonH,
    stickY,
    stickRadius,
    maxClusterW: toPx(CLUSTER_MAX_CSS),
  })
  const utilityW = clusterW * 0.5 - gap * 0.5

  buttons.push(
    {
      id:     'touch-view',
      label:  'view',
      action: 'view',
      rect:   { x: clusterX, y: utilityY, width: utilityW, height: buttonH },
      accent: 'cyan',
      hold:   false,
    },
    {
      id:     'touch-reset',
      label:  'reset',
      action: 'respawn',
      rect:   { x: clusterX + clusterW - utilityW, y: utilityY, width: utilityW, height: buttonH },
      accent: 'amber',
      hold:   false,
    }
  )

  const primaryH = buttonH * 1.25
  const primaryY = utilityY - gap - primaryH

  if (mode === 'battle') {
    const third = (clusterW - gap * 2) / 3
    buttons.push(
      {
        id:     'touch-secondary',
        label:  'msl',
        action: 'fire-secondary',
        rect:   { x: clusterX, y: primaryY, width: third, height: primaryH },
        accent: 'amber',
        hold:   true,
      },
      {
        id:     'touch-fire',
        label:  'fire',
        action: 'fire-primary',
        rect:   { x: clusterX + third + gap, y: primaryY - gap, width: third, height: primaryH + gap },
        accent: 'magenta',
        hold:   true,
      },
      {
        id:     'touch-boost',
        label:  'boost',
        action: 'boost',
        rect:   { x: clusterX + (third + gap) * 2, y: primaryY, width: third, height: primaryH },
        accent: 'violet',
        hold:   true,
      }
    )
  }
  else {
    const boostW = clusterW * 0.62
    buttons.push({
      id:     'touch-boost',
      label:  'boost',
      action: 'boost',
      rect:   { x: clusterX + clusterW * 0.5 - boostW * 0.5, y: primaryY, width: boostW, height: primaryH },
      accent: 'violet',
      hold:   true,
    })
  }

  return { sticks, buttons, stickTravel: stickRadius * 0.66, pixelScale }
}
