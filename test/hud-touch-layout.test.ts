import { describe, expect, it } from 'vitest'
import { touchLayout, wantsTouchControls } from 'Δengine/hud/touch-layout'
import type { TouchLayout, TouchLayoutInput } from 'Δengine/hud/touch-layout'
import type { HudMode } from 'Δengine/hud/types'


/**
 * Overlay canvases the compositor would actually build.
 *
 * It sizes to a fixed pixel budget at the viewport's exact aspect, so these are
 * derived the same way rather than written down — a canvas whose aspect differs
 * from the viewport's is the bug this layout exists to fix.
 */
function surface (cssWidth: number, cssHeight: number, mode: HudMode = 'race'): TouchLayoutInput {
  const aspect = cssWidth / cssHeight
  const height = Math.round(Math.sqrt(1280 * 720 / aspect))

  return {
    width:  Math.round(height * aspect),
    height,
    cssWidth,
    cssHeight,
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
    mode,
  }
}

const VIEWPORTS: Array<[string, number, number]> = [
  [ '16:9 desktop', 1600, 900 ],
  [ '19.5:9 portrait phone', 390, 844 ],
  [ 'landscape phone', 844, 390 ],
  [ 'squat tablet', 1024, 768 ],
]

type Box = { x: number; y: number; width: number; height: number }

const boxes = (layout: TouchLayout): Box[] => [
  ...layout.sticks.map(stick => ({
    x:      stick.centerX - stick.radius,
    y:      stick.centerY - stick.radius,
    width:  stick.radius * 2,
    height: stick.radius * 2,
  })),
  ...layout.buttons.map(button => button.rect),
]

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width &&
  a.y < b.y + b.height && b.y < a.y + a.height

describe('touch layout', () => {
  it.each(VIEWPORTS)('keeps every control on screen at %s', (_name, cssWidth, cssHeight) => {
    const input  = surface(cssWidth, cssHeight)
    const layout = touchLayout(input)

    for (const box of boxes(layout)) {
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(input.width + 0.5)
      expect(box.y + box.height).toBeLessThanOrEqual(input.height + 0.5)
    }
  })

  it.each(VIEWPORTS)('never overlaps two controls at %s', (_name, cssWidth, cssHeight) => {
    for (const mode of [ 'race', 'battle' ] as const) {
      const all = boxes(touchLayout(surface(cssWidth, cssHeight, mode)))
      for (let i = 0; i < all.length; i++)
        for (let j = i + 1; j < all.length; j++)
          expect(
            overlaps(all[i], all[j]),
            `${mode} ${cssWidth}x${cssHeight}: control ${i} overlaps ${j}`
          ).toBe(false)
    }
  })

  it.each(VIEWPORTS)('keeps every control tappable at %s', (_name, cssWidth, cssHeight) => {
    const layout = touchLayout(surface(cssWidth, cssHeight, 'battle'))

    // 44 CSS px is the floor below which a control is a coin toss. Converted
    // through the layout's own scale, so this checks the physical size rather
    // than a pixel count that means something different on every device.
    for (const box of boxes(layout)) {
      expect(box.width / layout.pixelScale).toBeGreaterThanOrEqual(43.5)
      expect(box.height / layout.pixelScale).toBeGreaterThanOrEqual(43.5)
    }
  })

  it('honours the safe area', () => {
    const input  = { ...surface(390, 844), insets: { top: 59, right: 0, bottom: 34, left: 0 }}
    const layout = touchLayout(input)
    const top    = 59 * layout.pixelScale
    const bottom = input.height - 34 * layout.pixelScale

    for (const box of boxes(layout)) {
      expect(box.y).toBeGreaterThanOrEqual(top - 0.5)
      expect(box.y + box.height).toBeLessThanOrEqual(bottom + 0.5)
    }
  })

  it('offers strafe and the air brake without a stick', () => {
    const actions = touchLayout(surface(390, 844)).buttons.map(button => button.action)
    expect(actions).toContain('strafe-left')
    expect(actions).toContain('strafe-right')
    expect(actions).toContain('airbrake')
  })

  it('gives the stick the travel it is drawn at', () => {
    const layout = touchLayout(surface(1024, 768))
    const stick  = layout.sticks[0]
    // The knob must reach the gate exactly when the thumb does — these were
    // measured in two different coordinate spaces and disagreed by 20 %.
    expect(layout.stickTravel).toBeLessThan(stick.radius)
    expect(layout.stickTravel).toBeGreaterThan(stick.radius * 0.5)
  })
})

/**
 * The rail went missing on tablets once, and every test here still passed —
 * because they all covered the LAYOUT, and what broke was the decision to draw
 * it at all. These cover the decision.
 */
describe('wants touch controls', () => {
  it('says yes to a coarse pointer', () => {
    expect(wantsTouchControls(null, true, 0)).toBe(true)
  })

  it('says yes to touch points on a fine pointer', () => {
    // An iPad in desktop mode reports `pointer: fine` and still has five touch
    //  points. Requiring both would leave it with no controls.
    expect(wantsTouchControls(null, false, 5)).toBe(true)
  })

  it('says no to a plain desktop', () => {
    expect(wantsTouchControls(null, false, 0)).toBe(false)
  })

  it('lets ?touch=1 force the rail on where the sniff said no', () => {
    expect(wantsTouchControls('1', false, 0)).toBe(true)
  })

  it('lets ?touch=0 force it off where the sniff said yes', () => {
    expect(wantsTouchControls('0', true, 5)).toBe(false)
  })

  it('ignores a value that is neither, rather than treating it as off', () => {
    expect(wantsTouchControls('yes please', true, 5)).toBe(true)
    expect(wantsTouchControls('', false, 0)).toBe(false)
  })
})
