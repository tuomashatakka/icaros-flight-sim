import { TEAM_COLORS } from '@crash-velocity/battle/arena'
import type { Controls } from '../input'
import { HudPanel } from './panel'
import { formatHudRaceTime } from './interaction'
import { HUD_COLORS as COLORS, HUD_FONT as FONT, HUD_TUNING_SPECS } from './tokens'
import type { BattleHudData, HudActionId, HudData, HudFrame, RaceHudData } from './types'


const TAU = Math.PI * 2

function fillPanel (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  color = 'rgba(3, 9, 15, .90)',
  stroke = 'rgba(88, 247, 239, .48)'
): void {
  context.fillStyle   = color
  context.strokeStyle = stroke
  context.lineWidth   = 2
  context.fillRect(x, y, width, height)
  context.strokeRect(x, y, width, height)
  context.globalAlpha = 0.25
  context.strokeRect(x + 9, y + 9, width - 18, height - 18)
  context.globalAlpha = 1
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
  id:      string;
  label:   string;
  x:       number;
  y:       number;
  width:   number;
  height:  number;
  action:  HudActionId;
  kind?:   'button' | 'hold';
  color?:  string;
  active?: boolean;
}

function overlayButton (
  overlay: HudPanel,
  options: OptionsType
): void {
  const { context }   = overlay
  const color         = options.color ?? COLORS.cyan
  const active        = options.active ?? false
  context.fillStyle   = active ? `${color}44` : 'rgba(6, 17, 25, .88)'
  context.strokeStyle = overlay.hovered === options.id ? COLORS.white : color
  context.lineWidth   = overlay.hovered === options.id ? 3 : 2
  context.fillRect(options.x, options.y, options.width, options.height)
  context.strokeRect(options.x, options.y, options.width, options.height)
  overlayText(context, options.label.toUpperCase(), options.x + options.width * 0.5, options.y + options.height * 0.5, Math.max(11, options.height * 0.24), color)
  overlay.region({
    id:     options.id,
    kind:   options.kind ?? 'button',
    x:      options.x,
    y:      options.y,
    width:  options.width,
    height: options.height,
    action: options.action,
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

function drawRaceFinish (overlay: HudPanel, data: RaceHudData): void {
  const { context, canvas } = overlay
  context.fillStyle         = 'rgba(1, 4, 8, .72)'
  context.fillRect(0, 0, canvas.width, canvas.height)

  const width  = Math.min(620, canvas.width - 40)
  const height = Math.min(520, canvas.height - 40)
  const x      = (canvas.width - width) * 0.5
  const y      = (canvas.height - height) * 0.5
  fillPanel(context, x, y, width, height)
  overlayText(context, 'COURSE COMPLETE', canvas.width * 0.5, y + 58, 28, COLORS.cyan)
  overlayText(context, `TOTAL ${formatHudRaceTime(data.clocks.elapsed)}`, canvas.width * 0.5, y + 122, 20)
  overlayText(context, `BEST ${data.race.bestLap === null ? '--:--.---' : formatHudRaceTime(data.race.bestLap)}`, canvas.width * 0.5, y + 158, 17, COLORS.amber)

  data.race.lapTimes.slice(0, 5).forEach((time, index) => {
    overlayText(context, `LAP ${index + 1}  ${formatHudRaceTime(time)}`, canvas.width * 0.5, y + 208 + index * 28, 14, COLORS.white)
  })

  const buttonY = y + height - 82
  overlayButton(overlay, { id: 'race-again', label: 'race again', x: x + 54, y: buttonY, width: width * 0.48 - 66, height: 50, action: 'race-again' })
  overlayButton(overlay, { id: 'finish-menu', label: 'menu', x: x + width * 0.52 + 12, y: buttonY, width: width * 0.48 - 66, height: 50, action: 'menu', color: COLORS.magenta })
}

function drawBattleFinish (overlay: HudPanel, data: BattleHudData): void {
  const { context, canvas } = overlay
  context.fillStyle         = 'rgba(1, 4, 8, .76)'
  context.fillRect(0, 0, canvas.width, canvas.height)

  const width  = Math.min(860, canvas.width - 36)
  const height = Math.min(570, canvas.height - 36)
  const x      = (canvas.width - width) * 0.5
  const y      = (canvas.height - height) * 0.5
  fillPanel(context, x, y, width, height)
  overlayText(context, 'MATCH OVER', canvas.width * 0.5, y + 52, 28, COLORS.white)
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

  overlayButton(overlay, { id: 'battle-finish-menu', label: 'return to menu', x: canvas.width * 0.5 - 130, y: y + height - 74, width: 260, height: 48, action: 'menu', color: COLORS.cyan })
}

function drawBattleError (overlay: HudPanel, data: BattleHudData): void {
  const { context, canvas } = overlay
  context.fillStyle         = 'rgba(1, 4, 8, .78)'
  context.fillRect(0, 0, canvas.width, canvas.height)

  const width  = Math.min(620, canvas.width - 40)
  const height = 240
  const x      = (canvas.width - width) * 0.5
  const y      = (canvas.height - height) * 0.5
  fillPanel(context, x, y, width, height, 'rgba(18, 3, 8, .92)', 'rgba(255, 84, 112, .72)')
  overlayText(context, 'CONNECTION FAILURE', canvas.width * 0.5, y + 58, 24, COLORS.red)
  overlayText(context, (data.battle.error ?? 'connection lost').toUpperCase(), canvas.width * 0.5, y + 112, 14, COLORS.white)
  overlayButton(overlay, { id: 'battle-error-menu', label: 'menu', x: canvas.width * 0.5 - 90, y: y + 160, width: 180, height: 46, action: 'menu', color: COLORS.red })
}

function drawTuning (overlay: HudPanel, data: RaceHudData, frame: HudFrame, copyUntil: number): void {
  const { context, canvas } = overlay
  context.fillStyle         = 'rgba(1, 4, 8, .80)'
  context.fillRect(0, 0, canvas.width, canvas.height)

  const width  = Math.min(900, canvas.width - 32)
  const height = Math.min(650, canvas.height - 32)
  const x      = (canvas.width - width) * 0.5
  const y      = (canvas.height - height) * 0.5
  fillPanel(context, x, y, width, height)
  overlayText(context, 'SHIP PHYSICS · LIVE TUNING', x + 34, y + 42, 20, COLORS.cyan, 'left')

  const rowStart = y + 92
  const rowGap   = Math.min(64, (height - 190) / HUD_TUNING_SPECS.length)
  const sliderX  = x + Math.min(230, width * 0.34)
  const sliderW  = width - (sliderX - x) - 54

  HUD_TUNING_SPECS.forEach((spec, index) => {
    const rowY  = rowStart + index * rowGap
    const value = data.tuning[spec.key]
    const ratio = (value - spec.min) / (spec.max - spec.min)
    overlayText(context, spec.label.toUpperCase(), x + 36, rowY, 13, COLORS.white, 'left')
    overlayText(context, String(value), sliderX - 18, rowY, 13, COLORS.amber, 'right')
    context.fillStyle = 'rgba(126, 168, 190, .18)'
    context.fillRect(sliderX, rowY - 5, sliderW, 10)
    context.fillStyle = COLORS.cyan
    context.fillRect(sliderX, rowY - 5, sliderW * ratio, 10)
    context.strokeStyle = 'rgba(215, 248, 255, .35)'
    context.strokeRect(sliderX, rowY - 5, sliderW, 10)
    context.fillStyle = COLORS.white
    context.fillRect(sliderX + sliderW * ratio - 4, rowY - 12, 8, 24)
    overlay.region({
      id:     `tuning:${spec.key}`,
      kind:   'slider',
      x:      sliderX,
      y:      rowY - 18,
      width:  sliderW,
      height: 36,
      tuning: spec,
    })
  })

  const buttonY = y + height - 68
  overlayButton(overlay, { id: 'tuning-close', label: 'close', x: x + 32, y: buttonY, width: 150, height: 42, action: 'tuning-toggle' })
  overlayButton(overlay, { id: 'tuning-reset', label: 'reset', x: x + width * 0.5 - 75, y: buttonY, width: 150, height: 42, action: 'tuning-reset', color: COLORS.amber })
  overlayButton(overlay, { id: 'tuning-copy', label: frame.elapsed < copyUntil ? 'copied' : 'copy as ts', x: x + width - 182, y: buttonY, width: 150, height: 42, action: 'tuning-copy', color: COLORS.magenta })
}

function drawTouchControls (
  overlay: HudPanel,
  data: HudData,
  controls: Controls,
  stickX: Record<'move' | 'aim', number>,
  stickY: Record<'move' | 'aim', number>
): void {
  const { context, canvas } = overlay
  const diameter            = Math.min(canvas.width * 0.25, canvas.height * 0.32, 210)
  const margin              = Math.max(18, canvas.width * 0.025)
  const y                   = canvas.height - diameter - margin

  drawTouchPad(overlay, 'move', margin, y, diameter, stickX.move, stickY.move)
  drawTouchPad(overlay, 'aim', canvas.width - diameter - margin, y, diameter, stickX.aim, stickY.aim)

  const actionWidth = Math.max(68, Math.min(112, canvas.width * 0.095))
  const actionGap   = 10
  const centerX     = canvas.width * 0.5
  const smallY      = canvas.height - 64
  overlayButton(overlay, { id: 'touch-view', label: 'view', x: centerX - actionWidth - actionGap * 0.5, y: smallY, width: actionWidth, height: 42, action: 'view' })
  overlayButton(overlay, { id: 'touch-reset', label: 'reset', x: centerX + actionGap * 0.5, y: smallY, width: actionWidth, height: 42, action: 'respawn', color: COLORS.amber })

  const holdY = smallY - 62
  if (data.mode === 'battle') {
    overlayButton(overlay, { id: 'touch-secondary', label: 'msl', x: centerX - actionWidth * 1.55 - actionGap, y: holdY, width: actionWidth, height: 50, action: 'fire-secondary', kind: 'hold', color: COLORS.amber, active: controls.fireSecondary })
    overlayButton(overlay, { id: 'touch-fire', label: 'fire', x: centerX - actionWidth * 0.5, y: holdY - 18, width: actionWidth, height: 68, action: 'fire-primary', kind: 'hold', color: COLORS.magenta, active: controls.fire })
    overlayButton(overlay, { id: 'touch-boost', label: 'boost', x: centerX + actionWidth * 0.55 + actionGap, y: holdY, width: actionWidth, height: 50, action: 'boost', kind: 'hold', color: COLORS.cyan, active: controls.boost })
  }
  else
    overlayButton(overlay, { id: 'touch-boost', label: 'boost', x: centerX - actionWidth * 0.5, y: holdY, width: actionWidth, height: 50, action: 'boost', kind: 'hold', color: COLORS.cyan, active: controls.boost })
}

function drawTouchPad (
  overlay: HudPanel,
  stick: 'move' | 'aim',
  x: number,
  y: number,
  diameter: number,
  offsetX: number,
  offsetY: number
): void {
  const { context }   = overlay
  const centerX       = x + diameter * 0.5
  const centerY       = y + diameter * 0.5
  const radius        = diameter * 0.5
  context.fillStyle   = 'rgba(4, 14, 22, .48)'
  context.strokeStyle = 'rgba(88, 247, 239, .32)'
  context.lineWidth   = 2
  context.beginPath()
  context.arc(centerX, centerY, radius, 0, TAU)
  context.fill()
  context.stroke()
  context.strokeStyle = 'rgba(88, 247, 239, .14)'
  context.beginPath()
  context.moveTo(centerX - radius, centerY)
  context.lineTo(centerX + radius, centerY)
  context.moveTo(centerX, centerY - radius)
  context.lineTo(centerX, centerY + radius)
  context.stroke()

  const knobRadius    = diameter * 0.15
  const knobX         = centerX + offsetX * diameter * 0.34
  const knobY         = centerY + offsetY * diameter * 0.34
  context.fillStyle   = 'rgba(88, 247, 239, .18)'
  context.strokeStyle = COLORS.cyan
  context.beginPath()
  context.arc(knobX, knobY, knobRadius, 0, TAU)
  context.fill()
  context.stroke()
  overlayText(context, stick.toUpperCase(), centerX, y + 18, 11, 'rgba(210, 250, 255, .55)')
  overlay.region({ id: `stick:${stick}`, kind: 'stick', stick, x, y, width: diameter, height: diameter })
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

  if (data.mode === 'race' && data.tuningOpen)
    drawTuning(overlay, data, frame, copyUntil)
  else if (data.mode === 'race' && data.race.status === 'finished')
    drawRaceFinish(overlay, data)
  else if (data.mode === 'battle' && data.battle.status === 'finished')
    drawBattleFinish(overlay, data)
  else if (data.mode === 'battle' && data.battle.status === 'error')
    drawBattleError(overlay, data)
  else {
    drawCountdown(overlay, data)
    if (isTouch)
      drawTouchControls(overlay, data, controls, stickX, stickY)
  }

  overlay.texture.needsUpdate = true
}
