/** Fraction of a virtual stick ignored around centre. */
export const HUD_STICK_DEADZONE = 0.16

/** Past this shaped Y value, the digital throttle/brake gates engage. */
export const HUD_AXIS_GATE = 0.32

/** Apply a radial-control deadzone while preserving a full -1..1 output range. */
export function shapeHudAxis (value: number): number {
  const magnitude = Math.abs(value)
  if (magnitude < HUD_STICK_DEADZONE)
    return 0
  return Math.sign(value) * (magnitude - HUD_STICK_DEADZONE) / (1 - HUD_STICK_DEADZONE)
}

/** Map a pointer position onto a stepped slider value. */
export function hudSliderValue (
  pointerX: number,
  startX: number,
  width: number,
  min: number,
  max: number,
  step: number
): number {
  const ratio = Math.max(0, Math.min(1, (pointerX - startX) / Math.max(width, 1)))
  const raw   = min + (max - min) * ratio
  const value = Math.round(raw / step) * step
  return Number(value.toFixed(6))
}

/** Compact mm:ss clock used by battle and whole-second status readouts. */
export function formatHudClock (seconds: number): string {
  if (!Number.isFinite(seconds))
    return '--:--'

  const minutes = Math.floor(Math.max(0, seconds) / 60)
  const rest    = Math.floor(Math.max(0, seconds) % 60)
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

/** Millisecond race clock, kept separate so battle does not waste visual noise. */
export function formatHudRaceTime (seconds: number): string {
  if (!Number.isFinite(seconds))
    return '--:--.---'

  // Scale first so a nominal .999 does not render as .998 from IEEE remainder
  // noise. The epsilon only repairs representation; it cannot advance real time.
  const totalMilliseconds = Math.floor(Math.max(0, seconds) * 1000 + 1e-6)
  const minutes           = Math.floor(totalMilliseconds / 60_000)
  const rest              = Math.floor(totalMilliseconds / 1000) % 60
  const milliseconds      = totalMilliseconds % 1000
  return `${minutes}:${String(rest).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`
}
