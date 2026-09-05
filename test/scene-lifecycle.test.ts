import { describe, expect, it, vi } from 'vitest'
import { attachSceneLifecycle } from 'Δcomponents/scene-lifecycle'


describe('scene lifecycle', () => {
  it('stops across visibility and intersection transitions, then detaches everything', () => {
    const documentTarget = new EventTarget() as Document
    Object.defineProperty(documentTarget, 'visibilityState', { value: 'visible', configurable: true })

    const windowTarget = new EventTarget() as Window
    const motion       = new EventTarget() as MediaQueryList
    Object.defineProperty(motion, 'matches', { value: false })
    Object.defineProperty(windowTarget, 'matchMedia', { value: () => motion })

    let intersection: IntersectionObserverCallback = () => {}
    const observe    = vi.fn()
    const disconnect = vi.fn()
    const app        = {
      running:          true,
      start:            vi.fn(),
      stop:             vi.fn(),
      lifecycleResume:  vi.fn(),
      setReducedMotion: vi.fn(),
    }
    const canvas = new EventTarget() as HTMLCanvasElement
    const detach = attachSceneLifecycle({
      document:           documentTarget,
      window:             windowTarget,
      canvas,
      app:                app as never,
      createIntersection: callback => {
        intersection = callback
        return { observe, disconnect } as unknown as IntersectionObserver
      },
    })

    Object.defineProperty(documentTarget, 'visibilityState', { value: 'hidden', configurable: true })
    documentTarget.dispatchEvent(new Event('visibilitychange'))
    expect(app.stop).toHaveBeenCalledOnce()
    Object.defineProperty(documentTarget, 'visibilityState', { value: 'visible', configurable: true })
    documentTarget.dispatchEvent(new Event('visibilitychange'))
    expect(app.lifecycleResume).toHaveBeenCalledOnce()
    expect(app.start).toHaveBeenCalledOnce()

    intersection([ { target: canvas, isIntersecting: false, intersectionRatio: 0 } as unknown as IntersectionObserverEntry ], {} as IntersectionObserver)
    expect(app.stop).toHaveBeenCalledTimes(2)
    intersection([ { target: canvas, isIntersecting: true, intersectionRatio: 1 } as unknown as IntersectionObserverEntry ], {} as IntersectionObserver)
    expect(app.lifecycleResume).toHaveBeenCalledTimes(2)

    detach()
    documentTarget.dispatchEvent(new Event('freeze'))
    expect(app.stop).toHaveBeenCalledTimes(2)
    expect(disconnect).toHaveBeenCalledOnce()
  })
})
