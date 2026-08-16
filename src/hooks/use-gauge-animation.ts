'use client'

import { useEffect, useRef } from 'react'

/**
 * One-shot mount animations for a stat gauge: the arc sweep (WAAPI, because the
 * target `stroke-dashoffset` is data and keyframing a `var()` needs `@property`
 * registration) and the numeric count-up (rAF — CSS cannot animate text).
 *
 * The gauges block is keyed by `shipId`, so selecting a ship remounts it and
 * both animations re-run. WAAPI animations cancel on unmount, so nothing leaks.
 */
export function useGaugeAnimation (finalFill: number, display: number, duration: number) {
  const arcRef      = useRef<SVGCircleElement>(null)
  const valueRef    = useRef<HTMLSpanElement>(null)
  const latestRef   = useRef({ finalFill, display, duration })
  latestRef.current = { finalFill, display, duration }

  useEffect(() => {
    const { finalFill: fill, display: to, duration: ms } = latestRef.current
    const arc                                            = arcRef.current

    if (arc) {
      const anim = arc.animate(
        [
          { strokeDashoffset: 100 },
          { strokeDashoffset: fill },
        ],
        { duration: ms, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', fill: 'forwards' }
      )
      // The sweep is the whole point of the double-buffered numbers; both run
      // for the same length so the count lands exactly when the arc does.
      anim.persist()
    }

    const readout = valueRef.current
    if (!readout)
      return

    const start = performance.now()
    const ease  = (t: number) => 1 - Math.pow(1 - t, 3)
    let raf = 0

    const tick = (now: number) => {
      const p             = Math.min((now - start) / ms, 1)
      readout.textContent = String(Math.round(to * ease(p)))
      if (p < 1)
        raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => cancelAnimationFrame(raf)
  }, [])

  return { arcRef, valueRef }
}
