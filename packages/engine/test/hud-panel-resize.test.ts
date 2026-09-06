import { describe, expect, it, vi } from 'vitest'
import { HudPanel } from 'Σhud/panel'


/**
 * The bug this covers made the touch controls invisible on every deployed
 * build and on no local one.
 *
 * A `CanvasTexture` allocates immutable GPU storage on its first upload. The
 * overlay is authored at 1280x720 and re-sized to the viewport's true aspect
 * the first time it draws, so on a 16:9 monitor the size never changes and
 * everything works; on a phone the resize lands after the first upload and
 * every later frame is a `texSubImage2D` outside the allocation — rejected by
 * the driver, silently, leaving the very first frame on screen forever. Which
 * of the two happened was a race between the resize observer and the first
 * rendered frame: a slow dev build won it, a production build lost it.
 *
 * Disposing on resize is what makes three re-allocate. Without it the fix is
 * invisible in every test that does not have a GPU, which is all of them —
 * hence asserting on the dispose itself.
 */
function stubPanel (width: number, height: number) {
  const dispose = vi.fn()
  const panel   = {
    canvas:  { width, height },
    texture: { dispose, needsUpdate: false },
  } as unknown as HudPanel

  return { panel, dispose, resize: HudPanel.prototype.resize.bind(panel) }
}

describe('hud panel resize', () => {
  it('throws the GPU allocation away with the raster', () => {
    const { panel, dispose, resize } = stubPanel(1280, 720)

    expect(resize(652, 1412)).toBe(true)
    expect(panel.canvas.width).toBe(652)
    expect(panel.canvas.height).toBe(1412)
    expect(dispose).toHaveBeenCalledOnce()
    expect(panel.texture.needsUpdate).toBe(true)
  })

  it('does nothing at all when the size is unchanged', () => {
    // Called on every frame that repaints, so a no-op has to be free — and a
    // dispose per frame would rebuild the texture 60 times a second.
    const { dispose, resize } = stubPanel(1280, 720)

    expect(resize(1280, 720)).toBe(false)
    expect(resize(1280.4, 719.7)).toBe(false)
    expect(dispose).not.toHaveBeenCalled()
  })

  it('never lets a rounding error produce a zero-sized raster', () => {
    const { panel, resize } = stubPanel(1280, 720)

    resize(0, 0.2)
    expect(panel.canvas.width).toBe(1)
    expect(panel.canvas.height).toBe(1)
  })
})
